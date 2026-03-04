/**
 * estimator_v1_smoke.test.mjs
 * Smoke test: EstimatorV1 mock mode, 25 items, 100% success.
 * Standalone — no HTTP server required.
 *
 * Pass criteria:
 *   - 25/25 items processed without error
 *   - All items have valid EstimatorOutputV1 shape
 *   - Two runs produce identical output (determinism)
 *   - Trust distribution printed: GREEN=X YELLOW=X RED=X
 *
 * Usage: node tests/behavior/estimator_v1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockEstimatorOutput } from '../../OppRadar/estimator_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET = path.resolve(__dirname, '../../data/evaluation_set_v1_260302.jsonl');

console.log('[TEST] estimator_v1_smoke — loading 25 markets...');

const lines = fs.readFileSync(EVAL_SET, 'utf8').trim().split('\n');
const markets = lines.map(l => JSON.parse(l));
assert.equal(markets.length, 25, `Expected 25 markets, got ${markets.length}`);

// Run #1
const results1 = markets.map(m => mockEstimatorOutput(m));

// Run #2 — determinism check
const results2 = markets.map(m => mockEstimatorOutput(m));
assert.deepStrictEqual(results1, results2, 'EstimatorV1 mock must be deterministic');

// Validate each result
const trustDist = { GREEN: 0, YELLOW: 0, RED: 0 };
let validCount = 0;

for (let i = 0; i < results1.length; i++) {
  const r = results1[i];
  const label = `[${i + 1}/25]`;

  // p_range shape
  assert(r.p_range && typeof r.p_range.low === 'number', `${label} p_range.low`);
  assert(typeof r.p_range.mid === 'number', `${label} p_range.mid`);
  assert(typeof r.p_range.high === 'number', `${label} p_range.high`);
  assert(r.p_range.low <= r.p_range.mid, `${label} low <= mid`);
  assert(r.p_range.mid <= r.p_range.high, `${label} mid <= high`);
  assert(r.p_range.low >= 0 && r.p_range.high <= 1, `${label} p_range in [0,1]`);

  // System-computed fields
  assert(typeof r.estimator_trust_score === 'number', `${label} trust_score`);
  assert(r.estimator_trust_score >= 0 && r.estimator_trust_score <= 100, `${label} trust_score range`);
  assert(['GREEN', 'YELLOW', 'RED'].includes(r.estimator_trust_level), `${label} trust_level`);
  assert(typeof r.p_mid === 'number', `${label} p_mid`);
  assert(typeof r.p_valid === 'boolean', `${label} p_valid`);
  assert(typeof r.range_width === 'number' || r.range_width === null, `${label} range_width`);
  assert(typeof r.dev_signed === 'number', `${label} dev_signed`);
  assert(typeof r.dev_abs === 'number', `${label} dev_abs`);
  assert(['OVER', 'UNDER', 'FAIR'].includes(r.dev_flag), `${label} dev_flag`);

  // LLM fields (normalized)
  assert(['High', 'Med', 'Low'].includes(r.confidence), `${label} confidence`);
  assert(Array.isArray(r.claims), `${label} claims array`);
  assert(Array.isArray(r.risk_triggers), `${label} risk_triggers`);
  assert(r.veto && ['ALLOW', 'DEGRADE', 'BLOCK'].includes(r.veto.decision), `${label} veto`);
  assert(['THIN', 'RULE', 'SLOW', 'UNKNOWN'].includes(r.mispricing_type), `${label} mispricing_type`);
  assert(typeof r.bullshit_score === 'number', `${label} bullshit_score`);

  // Provenance
  assert(r.provider === 'mock', `${label} provider`);
  assert(r._fallback === false, `${label} _fallback`);

  trustDist[r.estimator_trust_level]++;
  validCount++;
}

assert.equal(validCount, 25, `Expected 25 valid, got ${validCount}`);

console.log(`[PASS] estimator_v1_smoke | 25/25 success | GREEN=${trustDist.GREEN} YELLOW=${trustDist.YELLOW} RED=${trustDist.RED}`);
