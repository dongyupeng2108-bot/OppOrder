/**
 * estimator_v1.mjs
 * Pure EstimatorV1 module — no I/O, no side effects.
 *
 * Extracts and formalizes system-computed scoring from:
 *   - scripts/run_eval_deepseek_scan.mjs (computeSystemScores)
 *   - OppRadar/draft_generator.mjs (offset fields)
 *
 * Exports:
 *   buildEstimatorPrompt(market)
 *   normalizeLLMOutput(rawParsed)
 *   computeSystemFields(llmFields, yesPrice)
 *   assembleEstimatorOutput({ llmFields, systemFields, model, latency_ms, provider, fallback })
 *   mockEstimatorOutput(market)
 */

import crypto from 'crypto';

export const ESTIMATOR_VERSION = 'v1';

// ── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build the SCAN-profile prompt for a market.
 * Accepts both evaluation-set shape ({id, question, end_date, volume_24h, categories})
 * and scan-candidate shape ({title, question, yes_price, event_time, opp_id}).
 */
export function buildEstimatorPrompt(market) {
  const question = market.question || market.title || '';
  const id = market.id || market.opp_id || '';
  const endDate = market.end_date || market.event_time || '未知';
  const volume = market.volume_24h != null ? `$${market.volume_24h}` : '未知';
  const categories = Array.isArray(market.categories)
    ? market.categories.join(', ')
    : (market.selected_for || '');
  const yesPrice = market.yes_price != null ? String(market.yes_price) : '';

  let header = `你是一个预测市场估值器。请对以下市场进行分析并返回 JSON。

市场问题：${question}
市场ID：${id}
到期时间：${endDate}`;

  if (volume !== '未知') header += `\n24h成交量：${volume}`;
  if (categories) header += `\n分类：${categories}`;
  if (yesPrice) header += `\n当前 YES 价格：${yesPrice}`;

  return `${header}

请严格返回以下 JSON 结构（不要添加任何其他文字）：
{
  "p_range": { "low": 0.0, "mid": 0.5, "high": 1.0 },
  "confidence": "High|Med|Low",
  "claims": [
    {
      "claim_text": "断言内容",
      "basis_type": "INPUT|PRIOR|UNVERIFIED_FACT",
      "claim_impact": "MAJOR|MINOR"
    }
  ],
  "risk_triggers": ["trigger1"],
  "veto": {
    "decision": "ALLOW|DEGRADE|BLOCK",
    "labels": [],
    "rule_facts": {}
  },
  "rules_text": "该市场的结算规则理解（至少80字符）",
  "rules_unknown": false,
  "bullshit_score": 0,
  "why_1_liner": "一句话解释（≤160字符）",
  "mispricing_type": "THIN|RULE|SLOW|UNKNOWN"
}

注意：
- p_range: low <= mid <= high，均在 [0,1] 范围
- claims: 0-3条断言（SCAN档允许为空）
- bullshit_score: 0-100，衡量信息虚假程度，0=完全可信，100=完全不可信
- rules_text: 你对该市场结算规则的理解，至少80字符
- rules_unknown: 如果你无法确定结算规则则设为true`;
}

// ── Normalize LLM output ────────────────────────────────────────────────────

const VALID_CONFIDENCE = ['High', 'Med', 'Low'];
const VALID_VETO_DECISION = ['ALLOW', 'DEGRADE', 'BLOCK'];
const VALID_MISPRICING = ['THIN', 'RULE', 'SLOW', 'UNKNOWN'];
const VALID_BASIS_TYPE = ['INPUT', 'PRIOR', 'UNVERIFIED_FACT'];
const VALID_CLAIM_IMPACT = ['MAJOR', 'MINOR'];

/**
 * Sanitize raw LLM JSON output into normalized fields with safe defaults.
 * @param {object|null} raw — already JSON.parsed object from LLM
 * @returns {object} normalized llmFields
 */
export function normalizeLLMOutput(raw) {
  if (!raw) raw = {};

  // p_range
  let p_range = { low: 0.3, mid: 0.5, high: 0.7 };
  if (raw.p_range && typeof raw.p_range === 'object') {
    const lo = typeof raw.p_range.low === 'number' ? Math.max(0, Math.min(1, raw.p_range.low)) : 0.3;
    const hi = typeof raw.p_range.high === 'number' ? Math.max(0, Math.min(1, raw.p_range.high)) : 0.7;
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);
    const mid = typeof raw.p_range.mid === 'number'
      ? Math.max(low, Math.min(high, raw.p_range.mid))
      : parseFloat(((low + high) / 2).toFixed(4));
    p_range = { low, mid, high };
  }

  // confidence
  const confidence = VALID_CONFIDENCE.includes(raw.confidence) ? raw.confidence : 'Low';

  // claims (0..3)
  let claims = [];
  if (Array.isArray(raw.claims)) {
    claims = raw.claims.slice(0, 3).filter(c => c && typeof c === 'object').map(c => ({
      claim_text: typeof c.claim_text === 'string' ? c.claim_text : '',
      basis_type: VALID_BASIS_TYPE.includes(c.basis_type) ? c.basis_type : 'UNVERIFIED_FACT',
      claim_impact: VALID_CLAIM_IMPACT.includes(c.claim_impact) ? c.claim_impact : 'MINOR',
    }));
  }

  // risk_triggers (max 3)
  let risk_triggers = [];
  if (Array.isArray(raw.risk_triggers)) {
    risk_triggers = raw.risk_triggers.slice(0, 3).filter(t => typeof t === 'string');
  }

  // veto
  let veto = { decision: 'ALLOW', labels: [], rule_facts: {} };
  if (raw.veto && typeof raw.veto === 'object') {
    veto = {
      decision: VALID_VETO_DECISION.includes(raw.veto.decision) ? raw.veto.decision : 'ALLOW',
      labels: Array.isArray(raw.veto.labels) ? raw.veto.labels.filter(l => typeof l === 'string') : [],
      rule_facts: (raw.veto.rule_facts && typeof raw.veto.rule_facts === 'object') ? raw.veto.rule_facts : {},
    };
  }

  // scalars
  const rules_text = typeof raw.rules_text === 'string' ? raw.rules_text : '';
  const rules_unknown = raw.rules_unknown === true;
  const bullshit_score = typeof raw.bullshit_score === 'number'
    ? Math.max(0, Math.min(100, Math.round(raw.bullshit_score)))
    : 50;
  const why_1_liner = typeof raw.why_1_liner === 'string' ? raw.why_1_liner.slice(0, 160) : '';
  const mispricing_type = VALID_MISPRICING.includes(raw.mispricing_type) ? raw.mispricing_type : 'UNKNOWN';

  return {
    p_range, confidence, claims, risk_triggers, veto,
    rules_text, rules_unknown, bullshit_score,
    why_1_liner, mispricing_type,
  };
}

// ── System-computed fields ──────────────────────────────────────────────────

/**
 * Compute all system-derived fields from normalized LLM output.
 * Pure function — same input always returns same output.
 *
 * @param {object} llm — from normalizeLLMOutput()
 * @param {number} yesPrice — market's current yes price (0..1), default 0.5
 * @returns {object} systemFields
 */
export function computeSystemFields(llm, yesPrice = 0.5) {
  // Trust score
  const rulesPenalty = llm.rules_unknown ? 15 : 0;
  const trustScore = Math.max(0, Math.min(100, 100 - llm.bullshit_score - rulesPenalty));
  const trustLevel = trustScore >= 70 ? 'GREEN' : trustScore >= 40 ? 'YELLOW' : 'RED';

  // p_range validation
  const { low, mid, high } = llm.p_range;
  const pValid = low >= 0 && high <= 1 && low <= mid && mid <= high;
  const rangeWidth = pValid ? parseFloat((high - low).toFixed(4)) : null;
  const pMid = parseFloat(mid.toFixed(4));

  // Offset fields
  const price = typeof yesPrice === 'number' ? yesPrice : 0.5;
  const devSigned = parseFloat((pMid - price).toFixed(4));
  const devAbs = parseFloat(Math.abs(devSigned).toFixed(4));
  const devFlag = devSigned > 0.05 ? 'UNDER' : devSigned < -0.05 ? 'OVER' : 'FAIR';

  return {
    estimator_trust_score: trustScore,
    estimator_trust_level: trustLevel,
    rules_penalty: rulesPenalty,
    range_width: rangeWidth,
    p_mid: pMid,
    p_valid: pValid,
    dev_signed: devSigned,
    dev_abs: devAbs,
    dev_flag: devFlag,
  };
}

// ── Assemble EstimatorOutputV1 ──────────────────────────────────────────────

/**
 * Merge llmFields + systemFields + provenance into EstimatorOutputV1.
 */
export function assembleEstimatorOutput({ llmFields, systemFields, model, latency_ms, provider, fallback }) {
  return {
    ...llmFields,
    ...systemFields,
    model_used: model || 'unknown',
    latency_ms: latency_ms || 0,
    provider: provider || 'mock',
    _fallback: fallback || false,
  };
}

// ── Deterministic mock ──────────────────────────────────────────────────────

/**
 * Generate a deterministic EstimatorOutputV1 from market id.
 * Uses SHA256(market.id) to derive stable values. No LLM call.
 * @param {object} market — must have .id or .opp_id
 * @returns {object} EstimatorOutputV1 with provider='mock'
 */
export function mockEstimatorOutput(market) {
  const id = market.id || market.opp_id || '';
  const hash = crypto.createHash('sha256').update(id).digest('hex');

  // Derive deterministic values from hash segments
  const seg1 = parseInt(hash.slice(0, 8), 16);
  const seg2 = parseInt(hash.slice(8, 16), 16);
  const seg3 = parseInt(hash.slice(16, 24), 16);
  const seg4 = parseInt(hash.slice(24, 32), 16);

  // bullshit_score: 0..60 (keeps most items in GREEN/YELLOW)
  const bullshitScore = seg1 % 61;

  // p_range
  const pLow = parseFloat((0.1 + (seg2 / 0xFFFFFFFF) * 0.35).toFixed(4));
  const pHigh = parseFloat(Math.min(1, pLow + 0.15 + (seg3 / 0xFFFFFFFF) * 0.35).toFixed(4));
  const pMid = parseFloat(((pLow + pHigh) / 2).toFixed(4));

  // confidence
  const confIdx = seg4 % 3;
  const confidence = ['High', 'Med', 'Low'][confIdx];

  // mispricing_type
  const mispIdx = (seg1 >> 8) % 4;
  const mispricing_type = ['THIN', 'RULE', 'SLOW', 'UNKNOWN'][mispIdx];

  // rules_unknown: ~20% chance
  const rulesUnknown = (seg2 % 5) === 0;

  const yesPrice = market.yes_price != null ? market.yes_price : 0.5;

  const rawLLM = {
    p_range: { low: pLow, mid: pMid, high: pHigh },
    confidence,
    claims: [],
    risk_triggers: [],
    veto: { decision: 'ALLOW', labels: [], rule_facts: {} },
    rules_text: `[mock] Settlement rules derived from market ${id.slice(0, 16)}. The market resolves YES if the stated condition is met before the expiration date.`,
    rules_unknown: rulesUnknown,
    bullshit_score: bullshitScore,
    why_1_liner: '[mock] Deterministic estimator output',
    mispricing_type,
  };

  const llmFields = normalizeLLMOutput(rawLLM);
  const systemFields = computeSystemFields(llmFields, yesPrice);

  return assembleEstimatorOutput({
    llmFields,
    systemFields,
    model: 'mock-estimator-v1',
    latency_ms: 0,
    provider: 'mock',
    fallback: false,
  });
}
