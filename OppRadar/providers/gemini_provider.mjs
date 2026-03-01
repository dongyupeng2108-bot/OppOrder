/**
 * gemini_provider.mjs
 * M4-T5 (260301_018): Gemini 2.0 Flash API client for deep-dive snapshots.
 *
 * Exports:
 *   callGemini({ prompt, model? }) → DeepSnapshot object
 *
 * Requirements:
 *   - Uses globalThis.fetch (Node 18+, no external deps)
 *   - Reads GEMINI_API_KEY from process.env; throws if missing
 *   - 60-second timeout via AbortController
 *   - JSON parse failure → mock fallback (snapshot_type: "deep")
 *   - snapshot_type always "deep", model_used always "gemini-2.0-flash"
 */

import crypto from 'crypto';

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_TIMEOUT = 60_000; // ms

const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Build a deterministic mock deep-snapshot when the real API cannot be reached.
 * @param {string} prompt
 * @returns {object}
 */
function mockDeepSnapshot(prompt) {
  const hash = crypto.createHash('sha256').update(prompt).digest('hex');
  const conf = 0.5 + (parseInt(hash.slice(0, 4), 16) / 0xffff) * 0.49;
  return {
    snapshot_type:   'deep',
    model_used:      GEMINI_MODEL,
    summary:         `[Mock Deep] ${prompt.slice(0, 80)}…`,
    confidence:      parseFloat(conf.toFixed(2)),
    risk_triggers:   ['mock_trigger_1', 'mock_trigger_2'],
    p_range:         { low: 0.4, high: 0.6 },
    mispricing_type: 'other',
    why_1_liner:     '[mock] Insufficient data for deep analysis',
    what_to_check:   '[mock] Verify with live Gemini data',
    model_role:      'core',
    latency_ms:      0,
    _fallback:       true,
    created_at:      new Date().toISOString()
  };
}

/**
 * Call the Gemini 2.0 Flash API.
 *
 * @param {object} opts
 * @param {string} opts.prompt  – The full prompt text to send.
 * @param {string} [opts.model] – Ignored; always uses gemini-2.0-flash.
 * @returns {Promise<object>}   – DeepSnapshot fields merged with API response.
 */
export async function callGemini({ prompt, model: _model } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('callGemini: prompt must be a non-empty string');
  }

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
  });

  let rawText = null;
  try {
    const res = await globalThis.fetch(
      `${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[gemini_provider] HTTP ${res.status} — falling back to mock. Body: ${errBody.slice(0, 200)}`);
      return mockDeepSnapshot(prompt);
    }

    const json = await res.json();
    rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.warn(`[gemini_provider] Fetch error (${err.message}) — falling back to mock`);
    return mockDeepSnapshot(prompt);
  } finally {
    clearTimeout(timer);
  }

  if (!rawText) {
    console.warn('[gemini_provider] Empty text response — falling back to mock');
    return mockDeepSnapshot(prompt);
  }

  // Attempt to parse structured JSON from the response text.
  // Gemini sometimes wraps JSON in ```json … ``` fences.
  let parsed = null;
  try {
    const fence = rawText.match(/```json\s*([\s\S]*?)```/i);
    const jsonStr = fence ? fence[1] : rawText.trim();
    parsed = JSON.parse(jsonStr);
  } catch (_e) {
    console.warn('[gemini_provider] JSON parse failed — falling back to mock');
    return mockDeepSnapshot(prompt);
  }

  return {
    snapshot_type:   'deep',
    model_used:      GEMINI_MODEL,
    summary:         parsed.summary          || rawText.slice(0, 300),
    confidence:      parsed.confidence       ?? null,
    risk_triggers:   Array.isArray(parsed.risk_triggers) ? parsed.risk_triggers : [],
    p_range:         parsed.p_range          || null,
    yes_price:       parsed.yes_price        ?? null,
    mispricing_type: parsed.mispricing_type  || '',
    why_1_liner:     parsed.why_1_liner      || '',
    what_to_check:   parsed.what_to_check    || '',
    model_role:      'core',
    latency_ms:      Date.now() - t0,
    _fallback:       false,
    created_at:      new Date().toISOString(),
    _raw:            parsed
  };
}
