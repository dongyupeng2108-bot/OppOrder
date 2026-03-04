/**
 * ranker_v1_smoke.test.mjs
 * Smoke test: RankerV1 on 25 evaluation-set markets, 100% success.
 * Standalone — no HTTP server required.
 *
 * Usage: node tests/behavior/ranker_v1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockEstimatorOutput } from '../../OppRadar/estimator_v1.mjs';
import { mockVetoOutput } from '../../OppRadar/veto_v1.mjs';
import { assessRisk } from '../../OppRadar/risk_v1.mjs';
import { classifyOpportunity } from '../../OppRadar/filter_v1.mjs';
import { rankOpportunities } from '../../OppRadar/ranker_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET = path.resolve(__dirname, '../../data/evaluation_set_v1_260302.jsonl');

console.log('[TEST] ranker_v1_smoke — loading 25 markets...');

const lines = fs.readFileSync(EVAL_SET, 'utf8').trim().split('\n');
const markets = lines.map(l => JSON.parse(l));
assert.equal(markets.length, 25, `Expected 25 markets, got ${markets.length}`);

const AS_OF = '2026-03-04T12:00:00.000Z';

// Build candidates through full pipeline
const candidates = markets.map(m => {
  const meta = { ...m, as_of_utc: AS_OF };
  const estimator = mockEstimatorOutput(m);
  const veto = mockVetoOutput(m, estimator);
  const risk = assessRisk(estimator, meta);
  const filter = classifyOpportunity(estimator, veto, risk, meta);
  return { market: meta, estimator, veto, risk, filter };
});

// Run #1
const result1 = rankOpportunities(candidates);

// Run #2 — determinism
const result2 = rankOpportunities(candidates);
assert.deepStrictEqual(result1, result2, 'RankerV1 must be deterministic');

// Validate structure
assert.equal(typeof result1.total, 'number');
assert.equal(typeof result1.ranked_count, 'number');
assert.equal(typeof result1.skipped_count, 'number');
assert.equal(result1.total, 25);
assert.equal(result1.ranked_count + result1.skipped_count, 25);
assert(Array.isArray(result1.top_n));
assert(Array.isArray(result1.skipped));

// Validate ranked items
let prevScore = Infinity;
for (let i = 0; i < result1.top_n.length; i++) {
  const item = result1.top_n[i];
  const tag = `[ranked ${i + 1}/${result1.ranked_count}]`;

  assert(typeof item.opp_id === 'string' && item.opp_id.length > 0, `${tag} opp_id`);
  assert(typeof item.question === 'string', `${tag} question`);
  assert(typeof item.score === 'number', `${tag} score`);
  assert.equal(item.rank, i + 1, `${tag} rank`);
  assert(typeof item.rank_reason === 'string' && item.rank_reason.length > 0, `${tag} rank_reason`);

  // Sub-objects
  assert(item.estimator && typeof item.estimator.dev_abs === 'number', `${tag} estimator.dev_abs`);
  assert(item.veto && typeof item.veto.veto_light === 'string', `${tag} veto.veto_light`);
  assert(item.risk && typeof item.risk.risk_level === 'string', `${tag} risk.risk_level`);
  assert(item.filter && typeof item.filter.label === 'string', `${tag} filter.label`);
  assert.equal(item.filter.skip, false, `${tag} ranked items must have skip=false`);

  // Monotonic descending score
  assert(item.score <= prevScore, `${tag} score ${item.score} > prev ${prevScore}`);
  prevScore = item.score;
}

// Validate skipped items
for (let i = 0; i < result1.skipped.length; i++) {
  const item = result1.skipped[i];
  const tag = `[skipped ${i + 1}/${result1.skipped_count}]`;

  assert(typeof item.opp_id === 'string', `${tag} opp_id`);
  assert(typeof item.filter_label === 'string', `${tag} filter_label`);
  assert(typeof item.skip_reason === 'string', `${tag} skip_reason`);
}

// ── Priority unit tests ─────────────────────────────────────────────────────

// Empty input → empty output
const empty = rankOpportunities([]);
assert.equal(empty.total, 0);
assert.equal(empty.ranked_count, 0);
assert.equal(empty.skipped_count, 0);

// Single BLOCKED candidate → skipped
const blockedResult = rankOpportunities([{
  market: { id: 'test1', question: 'Q1' },
  estimator: { dev_abs: 0.1, range_width: 0.2 },
  veto: { veto_light: 'GREEN', veto_codes: ['PASS'] },
  risk: { risk_level: 'LOW', penalty: 0 },
  filter: { label: 'BLOCKED', skip: true, why_1_liner: 'Blocked' },
}]);
assert.equal(blockedResult.ranked_count, 0);
assert.equal(blockedResult.skipped_count, 1);
assert.equal(blockedResult.skipped[0].filter_label, 'BLOCKED');

// Score ordering: higher dev_abs ranks first (same penalty)
const orderResult = rankOpportunities([
  {
    market: { id: 'lo', question: 'Low dev' },
    estimator: { dev_abs: 0.05, range_width: 0.2 },
    veto: { veto_light: 'GREEN' },
    risk: { risk_level: 'LOW', penalty: 0 },
    filter: { label: 'UNKNOWN', skip: false, why_1_liner: 'ok' },
  },
  {
    market: { id: 'hi', question: 'High dev' },
    estimator: { dev_abs: 0.30, range_width: 0.2 },
    veto: { veto_light: 'GREEN' },
    risk: { risk_level: 'LOW', penalty: 0 },
    filter: { label: 'UNKNOWN', skip: false, why_1_liner: 'ok' },
  },
]);
assert.equal(orderResult.top_n[0].opp_id, 'hi');
assert.equal(orderResult.top_n[1].opp_id, 'lo');
assert.equal(orderResult.top_n[0].rank, 1);
assert.equal(orderResult.top_n[1].rank, 2);

// Penalty reduces score
const penaltyResult = rankOpportunities([
  {
    market: { id: 'risky', question: 'Risky' },
    estimator: { dev_abs: 0.20 },
    veto: {},
    risk: { risk_level: 'HIGH', penalty: 0.3 },
    filter: { label: 'RULE', skip: false, why_1_liner: 'risky' },
  },
  {
    market: { id: 'safe', question: 'Safe' },
    estimator: { dev_abs: 0.10 },
    veto: {},
    risk: { risk_level: 'LOW', penalty: 0 },
    filter: { label: 'UNKNOWN', skip: false, why_1_liner: 'ok' },
  },
]);
// risky: 0.20 - 0.30 = -0.10, safe: 0.10 - 0 = 0.10
assert.equal(penaltyResult.top_n[0].opp_id, 'safe');
assert.equal(penaltyResult.top_n[1].opp_id, 'risky');
assert(penaltyResult.top_n[1].score < 0, 'Negative score expected for high-penalty item');

console.log(`[PASS] ranker_v1_smoke | 25/25 success | ranked=${result1.ranked_count} skipped=${result1.skipped_count}`);
if (result1.top_n.length > 0) {
  console.log(`[INFO] Top score=${result1.top_n[0].score} | Bottom score=${result1.top_n[result1.top_n.length - 1].score}`);
}
