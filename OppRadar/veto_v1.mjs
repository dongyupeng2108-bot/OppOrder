/**
 * veto_v1.mjs
 * Pure VetoV1 engine — no I/O, no side effects.
 *
 * Rule checks run FIRST and take priority over LLM semantic veto.
 * evidence_basis labeled: RULE / LLM / HYBRID.
 *
 * Exports:
 *   runRuleChecks(input)        → { codes[], fired }
 *   runVeto({ estimatorOutput, market })  → VetoOutputV1
 *   mockVetoOutput(market)      → VetoOutputV1 (deterministic)
 *
 * VetoOutputV1 shape:
 *   veto_decision: ALLOW | DEGRADE | BLOCK
 *   veto_light:    GREEN | YELLOW | RED
 *   veto_codes:    string[]  (from veto_code enum)
 *   evidence_basis: RULE | LLM | HYBRID
 *   rule_fired:    boolean
 *   llm_fired:     boolean
 *   details:       { rule_results, llm_veto }
 */

import crypto from 'crypto';

export const VETO_VERSION = 'v1';

// ── veto_code enum (from schema_dict.yaml) ──────────────────────────────────

const VETO_CODES = [
  'RULE_AMBIGUITY',
  'QUESTION_RULE_MISMATCH',
  'DATA_UNVERIFIABLE',
  'MULTI_CONDITION_TRAP',
  'TIME_TOO_CLOSE',
  'EVIDENCE_GAP',
  'THIN_MARKET_RISK',
  'KNOWN_BAD_CLASS',
  'PASS',
];

// ── Rule-based checks (priority layer) ──────────────────────────────────────

/**
 * Run deterministic rule-based veto checks.
 * These fire BEFORE and override LLM semantic veto.
 *
 * @param {object} input
 * @param {object} input.estimator — EstimatorOutputV1 fields
 * @param {object} input.market    — market data (end_date, volume_24h, etc.)
 * @returns {{ codes: string[], fired: boolean }}
 */
export function runRuleChecks({ estimator, market }) {
  const codes = [];

  // R1: rules_unknown → RULE_AMBIGUITY
  if (estimator.rules_unknown === true) {
    codes.push('RULE_AMBIGUITY');
  }

  // R2: rules_text too short (<80 chars) → EVIDENCE_GAP
  if (typeof estimator.rules_text === 'string' && estimator.rules_text.length < 80) {
    codes.push('EVIDENCE_GAP');
  }

  // R3: time_too_close — end_date within 24h
  if (market.end_date) {
    const end = new Date(market.end_date);
    const now = new Date();
    const hoursLeft = (end.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft >= 0 && hoursLeft < 24) {
      codes.push('TIME_TOO_CLOSE');
    }
  }

  // R4: thin market — volume_24h < 1000
  if (typeof market.volume_24h === 'number' && market.volume_24h < 1000) {
    codes.push('THIN_MARKET_RISK');
  }

  // R5: p_valid=false → DATA_UNVERIFIABLE
  if (estimator.p_valid === false) {
    codes.push('DATA_UNVERIFIABLE');
  }

  // R6: bullshit_score >= 80 → DATA_UNVERIFIABLE
  if (typeof estimator.bullshit_score === 'number' && estimator.bullshit_score >= 80) {
    if (!codes.includes('DATA_UNVERIFIABLE')) {
      codes.push('DATA_UNVERIFIABLE');
    }
  }

  // R7: range_width > 0.6 → MULTI_CONDITION_TRAP
  if (typeof estimator.range_width === 'number' && estimator.range_width > 0.6) {
    codes.push('MULTI_CONDITION_TRAP');
  }

  return { codes, fired: codes.length > 0 };
}

// ── LLM veto extraction ─────────────────────────────────────────────────────

/**
 * Extract LLM-provided veto signal from estimator output.
 * @param {object} estimator — EstimatorOutputV1
 * @returns {{ decision: string, labels: string[], fired: boolean }}
 */
function extractLLMVeto(estimator) {
  const veto = estimator.veto || { decision: 'ALLOW', labels: [] };
  const decision = veto.decision || 'ALLOW';
  const labels = Array.isArray(veto.labels) ? veto.labels : [];
  const fired = decision !== 'ALLOW';
  return { decision, labels, fired };
}

// ── Decision merge (rule priority) ──────────────────────────────────────────

/**
 * Merge rule checks + LLM veto into final decision.
 * Rule layer takes priority: if rules fire BLOCK-level codes, result is BLOCK
 * regardless of LLM decision.
 *
 * @param {{ codes: string[], fired: boolean }} ruleResult
 * @param {{ decision: string, labels: string[], fired: boolean }} llmVeto
 * @returns {{ decision: string, light: string, codes: string[], basis: string }}
 */
function mergeDecision(ruleResult, llmVeto) {
  // Severity mapping for rule codes
  const BLOCK_CODES = ['DATA_UNVERIFIABLE', 'KNOWN_BAD_CLASS'];
  const DEGRADE_CODES = [
    'RULE_AMBIGUITY', 'QUESTION_RULE_MISMATCH', 'MULTI_CONDITION_TRAP',
    'TIME_TOO_CLOSE', 'EVIDENCE_GAP', 'THIN_MARKET_RISK',
  ];

  const allCodes = [...ruleResult.codes];

  // Map LLM labels to veto_codes if LLM fired
  if (llmVeto.fired) {
    for (const label of llmVeto.labels) {
      const upper = label.toUpperCase().replace(/[\s-]+/g, '_');
      if (VETO_CODES.includes(upper) && !allCodes.includes(upper)) {
        allCodes.push(upper);
      }
    }
  }

  // Determine evidence_basis
  let basis;
  if (ruleResult.fired && llmVeto.fired) basis = 'HYBRID';
  else if (ruleResult.fired) basis = 'RULE';
  else if (llmVeto.fired) basis = 'LLM';
  else basis = 'RULE'; // no veto = rule engine confirmed PASS

  // Determine decision — rule codes take priority
  let decision = 'ALLOW';

  // Check rule-based BLOCK
  if (ruleResult.codes.some(c => BLOCK_CODES.includes(c))) {
    decision = 'BLOCK';
  }
  // Check rule-based DEGRADE
  else if (ruleResult.codes.some(c => DEGRADE_CODES.includes(c))) {
    decision = 'DEGRADE';
  }
  // If rules didn't fire but LLM says BLOCK/DEGRADE, respect it (lower priority)
  else if (llmVeto.decision === 'BLOCK') {
    decision = 'BLOCK';
  }
  else if (llmVeto.decision === 'DEGRADE') {
    decision = 'DEGRADE';
  }

  // Map decision → veto_light
  let light;
  if (decision === 'BLOCK') light = 'RED';
  else if (decision === 'DEGRADE') light = 'YELLOW';
  else light = 'GREEN';

  // Final codes list
  const finalCodes = allCodes.length > 0 ? allCodes : ['PASS'];

  return { decision, light, codes: finalCodes, basis };
}

// ── Main entry: runVeto ─────────────────────────────────────────────────────

/**
 * Run the full veto pipeline on an estimator output + market data.
 *
 * @param {object} opts
 * @param {object} opts.estimatorOutput — from EstimatorV1
 * @param {object} opts.market          — market data
 * @returns {object} VetoOutputV1
 */
export function runVeto({ estimatorOutput, market }) {
  const ruleResult = runRuleChecks({ estimator: estimatorOutput, market: market || {} });
  const llmVeto = extractLLMVeto(estimatorOutput);
  const merged = mergeDecision(ruleResult, llmVeto);

  return {
    veto_decision: merged.decision,
    veto_light: merged.light,
    veto_codes: merged.codes,
    evidence_basis: merged.basis,
    rule_fired: ruleResult.fired,
    llm_fired: llmVeto.fired,
    details: {
      rule_results: ruleResult.codes,
      llm_veto: {
        decision: llmVeto.decision,
        labels: llmVeto.labels,
      },
    },
  };
}

// ── Deterministic mock ──────────────────────────────────────────────────────

/**
 * Generate a deterministic VetoOutputV1 from market data + estimator mock.
 * Uses SHA256(market.id) for stable derivation.
 *
 * @param {object} market — must have .id or .opp_id; optionally .end_date, .volume_24h
 * @param {object} estimatorOutput — from mockEstimatorOutput() or real estimator
 * @returns {object} VetoOutputV1
 */
export function mockVetoOutput(market, estimatorOutput) {
  return runVeto({ estimatorOutput, market });
}
