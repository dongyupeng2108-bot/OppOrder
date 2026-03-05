/**
 * live_provider.mjs
 * Real DeepSeek API integration for Polymarket opportunity analysis.
 *
 * Uses Node.js 18+ globalThis.fetch (no external dependency).
 * Reads DEEPSEEK_API_KEY from process.env (or .env file if present).
 *
 * Interface (unchanged): callLive({ prompt, model })
 *
 * Returns OpportunityCard-compatible result with M4 fields:
 *   p_range, confidence, risk_triggers, veto, snapshot_type, model_used, summary
 *
 * Fallback: if LLM returns non-JSON or parse fails, returns mock M4 data + error log.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ── .env loader (no dotenv dependency) ──────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
// OppRadar/providers/ → OppRadar/ → project root
const ENV_PATH = resolve(__dir, '..', '..', '.env');
if (existsSync(ENV_PATH)) {
  try {
    const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && val && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (_) { /* non-fatal */ }
}

// ── Constants ────────────────────────────────────────────────────────────────
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
const TIMEOUT_MS = 30_000;

// ── Prompt templates (hardcoded) ─────────────────────────────────────────────
const SYSTEM_PROMPT =
  '你是一个预测市场概率分析师。请对以下市场机会进行结构化分析，严格返回 JSON，不要有任何其他文字。' +
  ' JSON 必须包含以下字段：' +
  ' p_range (含 low 和 high，0到1之间的数字),' +
  ' confidence ("High"/"Med"/"Low"),' +
  ' risk_triggers (字符串数组，最多3个),' +
  ' veto (含 decision: "ALLOW"/"DEGRADE"/"BLOCK", labels: 字符串数组, rule_facts: 对象),' +
  ' summary (一段分析摘要字符串)。';

// ── Mock fallback for M4 fields ──────────────────────────────────────────────
function mockM4Fallback(reason) {
  return {
    id: `live_fallback_${Date.now()}`,
    title: 'Fallback Opportunity',
    score: 0.5,
    run_id: 'live_fallback',
    created_at: new Date().toISOString(),
    summary: `[Fallback] ${reason}`,
    provider: 'live_fallback',
    snapshot_type: 'draft',
    model_used: DEFAULT_MODEL,
    p_range: { low: 0.3, high: 0.7 },
    confidence: 'Low',
    risk_triggers: ['parse_failure', 'fallback_mode'],
    veto: {
      decision: 'DEGRADE',
      labels: ['fallback'],
      rule_facts: { reason }
    },
    _fallback: true,
    _error: reason
  };
}

// ── JSON extractor: strips markdown fences if present ───────────────────────
function extractJson(raw) {
  if (!raw) return null;
  // Try direct parse first
  try { return JSON.parse(raw); } catch (_) { /* continue */ }
  // Strip ```json ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch (_) { /* continue */ }
  }
  // Try finding first {...} block
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (_) { /* continue */ }
  }
  return null;
}

// ── DeepSeek API call (native fetch, 30s timeout) ───────────────────────────
async function callDeepSeek(userPrompt, model) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 1024,
    stream: false
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`DeepSeek HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  return response.json();
}

// ── M4 field mapper: parse LLM JSON into OpportunityCard M4 fields ──────────
function mapM4Fields(parsed, model) {
  // p_range
  const raw_p = parsed.p_range || {};
  const p_range = {
    low: typeof raw_p.low === 'number' ? Math.max(0, Math.min(1, raw_p.low)) : 0.3,
    high: typeof raw_p.high === 'number' ? Math.max(0, Math.min(1, raw_p.high)) : 0.7
  };
  if (p_range.low > p_range.high) p_range.low = p_range.high;

  // confidence
  const conf = parsed.confidence;
  const confidence = ['High', 'Med', 'Low'].includes(conf) ? conf : 'Low';

  // risk_triggers (max 3)
  const rt = Array.isArray(parsed.risk_triggers)
    ? parsed.risk_triggers.filter(x => typeof x === 'string').slice(0, 3)
    : [];

  // veto
  const raw_v = parsed.veto || {};
  const decisions = ['ALLOW', 'DEGRADE', 'BLOCK'];
  const veto = {
    decision: decisions.includes(raw_v.decision) ? raw_v.decision : 'ALLOW',
    labels: Array.isArray(raw_v.labels)
      ? raw_v.labels.filter(x => typeof x === 'string').slice(0, 3)
      : [],
    rule_facts: (raw_v.rule_facts && typeof raw_v.rule_facts === 'object')
      ? raw_v.rule_facts
      : {}
  };

  // score from midpoint of p_range
  const score = parseFloat(((p_range.low + p_range.high) / 2).toFixed(4));

  return { p_range, confidence, risk_triggers: rt, veto, score, model_used: model };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Call DeepSeek live API for Polymarket opportunity analysis.
 *
 * @param {{ prompt: string, model?: string }} opts
 *   prompt - Pre-formatted user message (built by caller with market data)
 *   model  - LLM model name (default: 'deepseek-chat')
 * @returns {Promise<object>} OpportunityCard-compatible result with M4 fields
 */
export async function callLive({ prompt, model = DEFAULT_MODEL }) {
  let apiResult;
  try {
    apiResult = await callDeepSeek(prompt, model);
  } catch (err) {
    console.error(`[live_provider] API call failed: ${err.message}`);
    return mockM4Fallback(err.message);
  }

  // Extract content from choices[0].message.content (or reasoning_content for deepseek-reasoner)
  const msg = apiResult?.choices?.[0]?.message || {};
  const rawContent = msg.content || msg.reasoning_content || '';
  const parsed = extractJson(rawContent);

  if (!parsed) {
    const reason = `JSON parse failed. Raw: ${rawContent.slice(0, 100)}`;
    console.error(`[live_provider] ${reason}`);
    return mockM4Fallback(reason);
  }

  const m4 = mapM4Fields(parsed, model);
  const summary = typeof parsed.summary === 'string' ? parsed.summary : rawContent.slice(0, 200);

  return {
    id: `live_${Date.now()}`,
    title: 'Live Opportunity',
    score: m4.score,
    run_id: 'live_run',
    created_at: new Date().toISOString(),
    summary,
    provider: 'live',
    snapshot_type: 'draft',
    model_used: model,
    p_range: m4.p_range,
    confidence: m4.confidence,
    risk_triggers: m4.risk_triggers,
    veto: m4.veto
  };
}
