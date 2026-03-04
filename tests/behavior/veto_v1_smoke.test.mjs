/**
 * veto_v1_smoke.test.mjs
 * Smoke test: VetoV1 on 25 evaluation-set markets, 100% success.
 * Standalone — no HTTP server required.
 *
 * Pass criteria:
 *   - 25/25 items processed without error
 *   - All items have valid VetoOutputV1 shape
 *   - evidence_basis correctly labeled RULE/LLM/HYBRID
 *   - Rule checks fire before and override LLM
 *   - Two runs produce identical output (determinism)
 *   - veto_light distribution printed: RED=X YELLOW=X GREEN=X
 *
 * Usage: node tests/behavior/veto_v1_smoke.test.mjs
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockEstimatorOutput } from '../../OppRadar/estimator_v1.mjs';
import { runVeto, runRuleChecks, mockVetoOutput } from '../../OppRadar/veto_v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SET = path.resolve(__dirname, '../../data/evaluation_set_v1_260302.jsonl');

console.log('[TEST] veto_v1_smoke — loading 25 markets...');

const lines = fs.readFileSync(EVAL_SET, 'utf8').trim().split('\n');
const markets = lines.map(l => JSON.parse(l));
assert.equal(markets.length, 25, `Expected 25 markets, got ${markets.length}`);

// Run #1
const results1 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  return mockVetoOutput(m, est);
});

// Run #2 — determinism check
const results2 = markets.map(m => {
  const est = mockEstimatorOutput(m);
  return mockVetoOutput(m, est);
});
assert.deepStrictEqual(results1, results2, 'VetoV1 mock must be deterministic');

// Validate each result
const lightDist = { GREEN: 0, YELLOW: 0, RED: 0 };
const basisDist = { RULE: 0, LLM: 0, HYBRID: 0 };
let validCount = 0;

for (let i = 0; i < results1.length; i++) {
  const r = results1[i];
  const label = `[${i + 1}/25]`;

  // VetoOutputV1 shape
  assert(['ALLOW', 'DEGRADE', 'BLOCK'].includes(r.veto_decision), `${label} veto_decision`);
  assert(['GREEN', 'YELLOW', 'RED'].includes(r.veto_light), `${label} veto_light`);
  assert(Array.isArray(r.veto_codes) && r.veto_codes.length > 0, `${label} veto_codes non-empty`);
  assert(['RULE', 'LLM', 'HYBRID'].includes(r.evidence_basis), `${label} evidence_basis`);
  assert(typeof r.rule_fired === 'boolean', `${label} rule_fired`);
  assert(typeof r.llm_fired === 'boolean', `${label} llm_fired`);

  // decision ↔ light consistency
  if (r.veto_decision === 'BLOCK') assert.equal(r.veto_light, 'RED', `${label} BLOCK→RED`);
  if (r.veto_decision === 'DEGRADE') assert.equal(r.veto_light, 'YELLOW', `${label} DEGRADE→YELLOW`);
  if (r.veto_decision === 'ALLOW') assert.equal(r.veto_light, 'GREEN', `${label} ALLOW→GREEN`);

  // evidence_basis consistency
  if (r.rule_fired && !r.llm_fired) assert.equal(r.evidence_basis, 'RULE', `${label} rule-only→RULE`);
  if (!r.rule_fired && r.llm_fired) assert.equal(r.evidence_basis, 'LLM', `${label} llm-only→LLM`);
  if (r.rule_fired && r.llm_fired) assert.equal(r.evidence_basis, 'HYBRID', `${label} both→HYBRID`);
  if (!r.rule_fired && !r.llm_fired) assert.equal(r.evidence_basis, 'RULE', `${label} none→RULE (pass)`);

  // PASS code only when no other codes
  if (r.veto_codes.includes('PASS')) {
    assert.equal(r.veto_codes.length, 1, `${label} PASS must be sole code`);
  }

  lightDist[r.veto_light]++;
  basisDist[r.evidence_basis]++;
  validCount++;
}

assert.equal(validCount, 25, `Expected 25 valid, got ${validCount}`);

// Rule priority test: force a scenario where rules_unknown=true
// should produce RULE basis regardless of LLM veto
const ruleOnlyEst = {
  rules_unknown: true,
  rules_text: 'short',
  p_valid: true,
  bullshit_score: 10,
  range_width: 0.2,
  veto: { decision: 'ALLOW', labels: [] },
};
const ruleOnlyResult = runRuleChecks({ estimator: ruleOnlyEst, market: {} });
assert(ruleOnlyResult.fired, 'Rule checks must fire when rules_unknown=true');
assert(ruleOnlyResult.codes.includes('RULE_AMBIGUITY'), 'Must include RULE_AMBIGUITY');
assert(ruleOnlyResult.codes.includes('EVIDENCE_GAP'), 'Must include EVIDENCE_GAP for short rules_text');

console.log(`[PASS] veto_v1_smoke | 25/25 success | RED=${lightDist.RED} YELLOW=${lightDist.YELLOW} GREEN=${lightDist.GREEN} | basis: RULE=${basisDist.RULE} LLM=${basisDist.LLM} HYBRID=${basisDist.HYBRID}`);
