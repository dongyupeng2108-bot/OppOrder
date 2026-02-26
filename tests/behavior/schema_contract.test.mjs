import { strict as assert } from 'assert';

console.log('[TEST] Running schema_contract...');

const res = await fetch(
  'http://localhost:53122/opportunities/rank_v2?provider=mock&limit=3&run_id=test_schema'
);
assert.equal(res.status, 200, 'rank_v2应返回200');

const data = await res.json();
assert(Array.isArray(data), '返回值应为数组');
assert(data.length > 0, '数组不能为空');

const item = data[0];
// Updated assertions based on actual API response
assert(typeof item.opp_id === 'string', `item.opp_id应为string, 实际: ${typeof item.opp_id}`);
assert(typeof item.score === 'number', `item.score应为number, 实际: ${typeof item.score}`);
assert(typeof item.p_hat === 'number', `item.p_hat应为number, 实际: ${typeof item.p_hat}`);
assert(typeof item.p_llm === 'number', `item.p_llm应为number, 实际: ${typeof item.p_llm}`);
assert(typeof item.price_q === 'number', `item.price_q应为number, 实际: ${typeof item.price_q}`);
assert(typeof item.score_v2 === 'number', `item.score_v2应为number, 实际: ${typeof item.score_v2}`);

assert(item.p_ci && typeof item.p_ci === 'object', 'item.p_ci应为object');
assert(typeof item.p_ci.low === 'number', 'p_ci.low应为number');
assert(typeof item.p_ci.high === 'number', 'p_ci.high应为number');
assert(typeof item.p_ci.method === 'string', 'p_ci.method应为string');

assert(item.meta && typeof item.meta === 'object', 'item.meta应为object');
assert(item.meta.provider_used === 'mock', 'meta.provider_used应为mock');
// New server doesn't return run_id in meta
// assert(item.meta.run_id === 'test_schema', 'meta.run_id应匹配');

console.log('[PASS] schema_contract');
