/**
 * filter_v1_smoke.test.mjs
 * Smoke test: FilterV1 on 25 evaluation-set markets, 100% success.
 * Standalone — no HTTP server required.
 *
 * Usage: node tests/behavior/filter_v1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockEstimatorOutput } from '../../OppRadar/estimator_v1.mjs';
import { mockVetoOutput } from '../../OppRadar/veto_v1.mjs';
import { assessRisk } from '../../OppRadar/risk_v1.mjs';
import { classifyOpportunity } from '../../OppRadar/filter_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET = path.resolve(__dirname, '../../data/evaluation_set_v1_260302.jsonl');

console.log('[TEST] filter_v1_smoke — loading 25 markets...');

const lines = fs.readFileSync(EVAL_SET, 'utf8').trim().split('\n');
const markets = lines.map(l => JSON.parse(l));
assert.equal(markets.length, 25, `Expected 25 markets, got ${markets.length}`);

const AS_OF = '2026-03-04T12:00:00.000Z';
const VALID_LABELS = ['BLOCKED', 'THIN', 'RULE', 'SLOW', 'UNKNOWN'];

// Run #1
const results1 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  const veto = mockVetoOutput(m, est);
  const risk = assessRisk(est, { ...m, as_of_utc: AS_OF });
  return classifyOpportunity(est, veto, risk, { ...m, as_of_utc: AS_OF });
});

// Run #2 — determinism
const results2 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  const veto = mockVetoOutput(m, est);
  const risk = assessRisk(est, { ...m, as_of_utc: AS_OF });
  return classifyOpportunity(est, veto, risk, { ...m, as_of_utc: AS_OF });
});
assert.deepStrictEqual(results1, results2, 'FilterV1 must be deterministic');

// Validate + collect distribution
const labelDist = { BLOCKED: 0, THIN: 0, RULE: 0, SLOW: 0, UNKNOWN: 0 };
let validCount = 0;

for (let i = 0; i < results1.length; i++) {
  const r = results1[i];
  const tag = `[${i + 1}/25]`;

  assert(VALID_LABELS.includes(r.label), `${tag} label=${r.label}`);
  assert(typeof r.skip === 'boolean', `${tag} skip`);
  assert(typeof r.why_1_liner === 'string' && r.why_1_liner.length <= 80, `${tag} why_1_liner <=80`);
  assert(typeof r.dev_abs === 'number' || r.dev_abs === null, `${tag} dev_abs`);
  assert(typeof r.triggered_rule === 'number', `${tag} triggered_rule`);

  // BLOCKED must skip, others must not
  if (r.label === 'BLOCKED') assert.equal(r.skip, true, `${tag} BLOCKED→skip`);
  else assert.equal(r.skip, false, `${tag} non-BLOCKED→!skip`);

  labelDist[r.label]++;
  validCount++;
}

assert.equal(validCount, 25, `Expected 25 valid, got ${validCount}`);

// ── Priority unit tests ─────────────────────────────────────────────────────

// Rule 1: veto RED → BLOCKED
const f1 = classifyOpportunity(
  { dev_abs: 0.1, range_width: 0.2, claims: [] },
  { veto_light: 'RED', veto_codes: ['DATA_UNVERIFIABLE'] },
  { risk_level: 'LOW' },
  {}
);
assert.equal(f1.label, 'BLOCKED');
assert.equal(f1.skip, true);

// Rule 2: wide range + no claims → THIN
const f2 = classifyOpportunity(
  { dev_abs: 0.2, range_width: 0.5, claims: [] },
  { veto_light: 'GREEN', veto_codes: ['PASS'] },
  { risk_level: 'LOW' },
  {}
);
assert.equal(f2.label, 'THIN');

// Rule 3: YELLOW veto + RULE code → RULE
const f3 = classifyOpportunity(
  { dev_abs: 0.2, range_width: 0.2, claims: [{ claim_text: 'x' }] },
  { veto_light: 'YELLOW', veto_codes: ['RULE_AMBIGUITY'] },
  { risk_level: 'LOW' },
  {}
);
assert.equal(f3.label, 'RULE');

// Rule 4: HIGH risk → RULE
const f4 = classifyOpportunity(
  { dev_abs: 0.2, range_width: 0.2, claims: [{ claim_text: 'x' }] },
  { veto_light: 'GREEN', veto_codes: ['PASS'] },
  { risk_level: 'HIGH', reason: 'HIGH_UNCERTAINTY' },
  {}
);
assert.equal(f4.label, 'RULE');

// Rule 5: expiry < 3d → SLOW
const f5 = classifyOpportunity(
  { dev_abs: 0.2, range_width: 0.2, claims: [{ claim_text: 'x' }] },
  { veto_light: 'GREEN', veto_codes: ['PASS'] },
  { risk_level: 'LOW' },
  { end_date: '2026-03-06T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(f5.label, 'SLOW');

// Rule 6: dev_abs < 0.05 → SLOW
const f6 = classifyOpportunity(
  { dev_abs: 0.03, range_width: 0.2, claims: [{ claim_text: 'x' }] },
  { veto_light: 'GREEN', veto_codes: ['PASS'] },
  { risk_level: 'LOW' },
  { end_date: '2026-06-01T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(f6.label, 'SLOW');

// Rule 7: fallthrough → UNKNOWN
const f7 = classifyOpportunity(
  { dev_abs: 0.2, range_width: 0.2, claims: [{ claim_text: 'x' }] },
  { veto_light: 'GREEN', veto_codes: ['PASS'] },
  { risk_level: 'LOW' },
  { end_date: '2026-06-01T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(f7.label, 'UNKNOWN');

console.log(`[PASS] filter_v1_smoke | 25/25 success | BLOCKED=${labelDist.BLOCKED} THIN=${labelDist.THIN} RULE=${labelDist.RULE} SLOW=${labelDist.SLOW} UNKNOWN=${labelDist.UNKNOWN}`);
