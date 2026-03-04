/**
 * risk_v1_smoke.test.mjs
 * Smoke test: RiskV1 on 25 evaluation-set markets, 100% success.
 * Standalone — no HTTP server required.
 *
 * Pass criteria:
 *   - 25/25 items processed without error
 *   - All items have valid RiskResultV1 shape
 *   - First-match-wins priority verified
 *   - Two runs produce identical output (determinism)
 *   - risk_level distribution printed: HIGH=X MED=X LOW=X
 *
 * Usage: node tests/behavior/risk_v1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockEstimatorOutput } from '../../OppRadar/estimator_v1.mjs';
import { assessRisk } from '../../OppRadar/risk_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET = path.resolve(__dirname, '../../data/evaluation_set_v1_260302.jsonl');

console.log('[TEST] risk_v1_smoke — loading 25 markets...');

const lines = fs.readFileSync(EVAL_SET, 'utf8').trim().split('\n');
const markets = lines.map(l => JSON.parse(l));
assert.equal(markets.length, 25, `Expected 25 markets, got ${markets.length}`);

// Use a fixed as_of_utc so results are deterministic regardless of when test runs
const AS_OF = '2026-03-04T12:00:00.000Z';

// Run #1
const results1 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  return assessRisk(est, { ...m, as_of_utc: AS_OF });
});

// Run #2 — determinism check
const results2 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  return assessRisk(est, { ...m, as_of_utc: AS_OF });
});
assert.deepStrictEqual(results1, results2, 'RiskV1 must be deterministic');

// Validate each result
const levelDist = { HIGH: 0, MED: 0, LOW: 0 };
let validCount = 0;

for (let i = 0; i < results1.length; i++) {
  const r = results1[i];
  const label = `[${i + 1}/25]`;

  // RiskResultV1 shape
  assert(['HIGH', 'MED', 'LOW'].includes(r.risk_level), `${label} risk_level`);
  assert(typeof r.reason === 'string' && r.reason.length > 0, `${label} reason`);
  assert(typeof r.penalty === 'number', `${label} penalty`);
  assert(typeof r.triggered_rule === 'number', `${label} triggered_rule`);
  assert(typeof r.details === 'object', `${label} details`);

  // Penalty consistency
  if (r.risk_level === 'HIGH') assert.equal(r.penalty, 0.3, `${label} HIGH penalty`);
  if (r.risk_level === 'MED') assert.equal(r.penalty, 0.15, `${label} MED penalty`);
  if (r.risk_level === 'LOW') assert.equal(r.penalty, 0, `${label} LOW penalty`);

  levelDist[r.risk_level]++;
  validCount++;
}

assert.equal(validCount, 25, `Expected 25 valid, got ${validCount}`);

// ── Priority order unit tests ───────────────────────────────────────────────

// Rule 1: catastrophic triggers override everything
const r1 = assessRisk(
  { risk_triggers: ['BLACK_SWAN'], range_width: 0.1, estimator_trust_level: 'GREEN', confidence: 'High' },
  {}
);
assert.equal(r1.risk_level, 'HIGH', 'Rule 1: BLACK_SWAN → HIGH');
assert.equal(r1.reason, 'CATASTROPHIC_TRIGGER');
assert.equal(r1.triggered_rule, 1);

// Rule 2: high range_width
const r2 = assessRisk(
  { risk_triggers: [], range_width: 0.6, estimator_trust_level: 'GREEN', confidence: 'High' },
  {}
);
assert.equal(r2.risk_level, 'HIGH', 'Rule 2: range_width=0.6 → HIGH');
assert.equal(r2.reason, 'HIGH_UNCERTAINTY');

// Rule 3: RED trust
const r3 = assessRisk(
  { risk_triggers: [], range_width: 0.2, estimator_trust_level: 'RED', confidence: 'High' },
  {}
);
assert.equal(r3.risk_level, 'HIGH', 'Rule 3: RED trust → HIGH');
assert.equal(r3.reason, 'UNTRUSTWORTHY_ESTIMATE');

// Rule 4: normal triggers → MED
const r4 = assessRisk(
  { risk_triggers: ['some_trigger'], range_width: 0.2, estimator_trust_level: 'GREEN', confidence: 'High' },
  {}
);
assert.equal(r4.risk_level, 'MED', 'Rule 4: normal trigger → MED');
assert.equal(r4.reason, 'KNOWN_RISK_FACTOR');

// Rule 5: Low confidence → MED
const r5 = assessRisk(
  { risk_triggers: [], range_width: 0.2, estimator_trust_level: 'GREEN', confidence: 'Low' },
  {}
);
assert.equal(r5.risk_level, 'MED', 'Rule 5: Low confidence → MED');
assert.equal(r5.reason, 'LOW_CONFIDENCE');

// Rule 6: expiry soon → MED
const r6 = assessRisk(
  { risk_triggers: [], range_width: 0.2, estimator_trust_level: 'GREEN', confidence: 'High' },
  { end_date: '2026-03-08T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(r6.risk_level, 'MED', 'Rule 6: 4 days left → MED');
assert.equal(r6.reason, 'EXPIRY_SOON');

// Rule 7: no risk
const r7 = assessRisk(
  { risk_triggers: [], range_width: 0.2, estimator_trust_level: 'GREEN', confidence: 'High' },
  { end_date: '2026-06-01T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(r7.risk_level, 'LOW', 'Rule 7: no risk → LOW');
assert.equal(r7.reason, 'NO_SIGNIFICANT_RISK');

// Priority: Rule 1 beats Rule 2
const rPriority = assessRisk(
  { risk_triggers: ['REGIME_CHANGE'], range_width: 0.9, estimator_trust_level: 'RED', confidence: 'Low' },
  { end_date: '2026-03-05T00:00:00Z', as_of_utc: '2026-03-04T00:00:00Z' }
);
assert.equal(rPriority.triggered_rule, 1, 'Priority: Rule 1 wins over all');

console.log(`[PASS] risk_v1_smoke | 25/25 success | HIGH=${levelDist.HIGH} MED=${levelDist.MED} LOW=${levelDist.LOW}`);
