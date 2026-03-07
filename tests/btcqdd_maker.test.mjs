// tests/btcqdd_maker.test.mjs — pair_tracker + maker_strategy 单元测试

import { createPairTracker } from '../strategies/crypto_binary/pair_tracker.mjs';
import { createMakerStrategy } from '../strategies/crypto_binary/maker_strategy.mjs';
import { createOrderManager } from '../strategies/crypto_binary/order_manager.mjs';
import { createCancelEngine } from '../strategies/crypto_binary/cancel_engine.mjs';
import fs from 'fs';

const base = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8'));
const config = {
  ...base,
  strategy: {
    ...base.strategy,
    entry_offset: 0.02,
    entry_offset_base: 0.02,
    vol_adjust_enabled: false,
    vol_adjust_factor: 1.0,
    min_price_deviation: 0.05,
    price_zone_filter: [[0, 0.35], [0.65, 1.0]],
    pair_cost_target: 0.97,
    balance_max_ratio: 1.5,
    requote_threshold: 0.01,
    order_tranches: 1,
    tranche_spread: 0.5,
    tranche_weights: [1.0],
  },
  regime: { min_score: 0.5, max_score: 1.0 },
  paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
};

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

function makeDeps() {
  const orderManager = createOrderManager(config);
  const pairTracker = createPairTracker(config);
  const cancelEngine = createCancelEngine(config, orderManager);
  return { orderManager, pairTracker, cancelEngine };
}

const baseSnapshot = {
  bid_up: 0.69, ask_up: 0.71, mid_up: 0.70,
  bid_down: 0.29, ask_down: 0.31, mid_down: 0.30,
  spread_up: 0.02, spread_down: 0.02,
  tick_size: 0.01, tick_size_changed: false,
  up_token_id: 'tok_up', down_token_id: 'tok_down',
  sampled_at: new Date(),
};

const windowEnd = new Date(Date.now() + 300 * 1000); // 5 分钟后

console.log('\n=== pair_tracker 测试 ===');

{
  const pt = createPairTracker(config);

  // 初始状态
  const s = pt.getState();
  assert(s.pair_cost === null, '初始 pair_cost=null');
  assert(s.balance_ratio === null, '初始 balance_ratio=null');

  // UP 侧成交：$5 @ 0.70 → qty=7.14
  pt.recordFill('UP', 0.70, 5);
  assert(Math.abs(pt.getState().avg_up - 0.70) < 1e-9, `avg_up=0.70`);
  assert(pt.getState().pair_cost === null, '单侧时 pair_cost=null');

  // DOWN 侧成交：$5 @ 0.30 → pair_cost = 0.70+0.30 = 1.00
  pt.recordFill('DOWN', 0.30, 5);
  const st = pt.getState();
  assert(Math.abs(st.pair_cost - 1.00) < 1e-9, `pair_cost=1.00`);
  assert(st.balance_ratio !== null, 'balance_ratio 有值');
}

{
  const pt = createPairTracker(config);
  // simulateFill 不改变状态
  pt.recordFill('UP', 0.65, 5);
  const simCost = pt.simulateFill('DOWN', 0.30, 5);
  assert(simCost !== null, 'simulateFill 返回值非 null');
  assert(pt.getState().qty_down === 0, 'simulateFill 不改变实际状态');
}

{
  const pt = createPairTracker(config);
  // pair_cost 未达标时 shouldPlaceOrder 返回 true
  pt.recordFill('UP', 0.50, 5);
  pt.recordFill('DOWN', 0.50, 5);
  // pair_cost = 0.50 + 0.50 = 1.00 > target=0.97，shouldPlaceOrder 应仍为 true
  assert(pt.shouldPlaceOrder('UP', null) === true, 'pair_cost=1.0 > target，仍可挂单');

  // 模拟达标情况
  const pt2 = createPairTracker(config);
  pt2.recordFill('UP', 0.47, 5);
  pt2.recordFill('DOWN', 0.48, 5); // pair_cost=0.95 < 0.97
  assert(pt2.shouldPlaceOrder('UP', null) === false, 'pair_cost < target，停止挂单');
}

console.log('\n=== maker_strategy 基础流程测试 ===');

{
  const deps = makeDeps();
  const strategy = createMakerStrategy(config, deps);

  // regime_score 在激活区间，应产出 PLACE 动作
  const { actions } = strategy.onMarketData({
    snapshot: baseSnapshot,
    regime_score: 0.7,
    sigma: 0.35,
    windowEnd,
  });
  const hasPlace = actions.some(a => a.startsWith('PLACE_'));
  assert(hasPlace, `regime_score=0.7 在激活区间，产出 PLACE 动作: ${actions.join(' | ')}`);
}

{
  // regime_score 不在激活区间 → 休眠
  const deps = makeDeps();
  const strategy = createMakerStrategy(config, deps);
  const { actions } = strategy.onMarketData({
    snapshot: baseSnapshot,
    regime_score: 0.3, // < min_score=0.5
    sigma: 0.35,
    windowEnd,
  });
  assert(actions[0].startsWith('SLEEP'), `regime_score=0.3 < 0.5，休眠: ${actions[0]}`);
}

console.log('\n=== price_zone_filter 测试 ===');

{
  const deps = makeDeps();
  const strategy = createMakerStrategy(config, deps);

  // mid_up=0.50，在过滤区间 [0.35, 0.65]，应跳过
  const midSnapshot = { ...baseSnapshot, mid_up: 0.50, bid_up: 0.49, ask_up: 0.51 };
  const { actions } = strategy.onMarketData({
    snapshot: midSnapshot,
    regime_score: 0.7,
    sigma: 0.35,
    windowEnd,
  });
  const isSkipped = actions.some(a => a.startsWith('SKIP') && a.includes('price_zone'));
  assert(isSkipped, `mid_up=0.50 在过滤区间，跳过: ${actions[0]}`);
}

console.log('\n=== 首单条件测试 ===');

{
  const deps = makeDeps();
  const strategy = createMakerStrategy(config, deps);

  // mid_up=0.52，偏离 0.50 仅 0.02 < min_price_deviation=0.05，等待
  const snapshot52 = { ...baseSnapshot, mid_up: 0.52, bid_up: 0.51, ask_up: 0.53 };
  // 先把 price_zone_filter 关掉（让 0.52 通过 zone 检查）
  const configNoZone = { ...config, strategy: { ...config.strategy, price_zone_filter: [] } };
  const deps2 = makeDeps();
  const s2 = createMakerStrategy(configNoZone, deps2);
  const { actions } = s2.onMarketData({
    snapshot: { ...snapshot52, up_token_id: 'tok_up', down_token_id: 'tok_down' },
    regime_score: 0.7,
    sigma: 0.35,
    windowEnd,
  });
  const isWaiting = actions.some(a => a.startsWith('WAIT'));
  assert(isWaiting, `偏离 0.02 < 0.05，等待: ${actions[0]}`);
}

console.log('\n=== 动态 offset 测试 ===');

{
  const configDyn = {
    ...config,
    strategy: {
      ...config.strategy,
      vol_adjust_enabled: true,
      entry_offset_base: 0.02,
      vol_adjust_factor: 1.0,
    },
  };
  const deps = makeDeps();
  const strategy = createMakerStrategy(configDyn, deps);

  const offsetLow = strategy.calcOffset(0.1);   // sigma 低 → offset 接近 base
  const offsetHigh = strategy.calcOffset(1.0);  // sigma 高 → offset 更大
  assert(offsetHigh > offsetLow, `动态 offset: sigma 高时更大 (${offsetLow.toFixed(4)} < ${offsetHigh.toFixed(4)})`);
  assert(Math.abs(strategy.calcOffset(0) - 0.02) < 1e-9, '动态 offset: sigma=0 时等于 base');
}

console.log('\n=== inPriceZone 测试 ===');

{
  const deps = makeDeps();
  const s = createMakerStrategy(config, deps);
  assert(s.inPriceZone(0.20) === true,  'inPriceZone(0.20) = true');
  assert(s.inPriceZone(0.35) === true,  'inPriceZone(0.35) = true（边界包含）');
  assert(s.inPriceZone(0.50) === false, 'inPriceZone(0.50) = false（中间区间过滤）');
  assert(s.inPriceZone(0.65) === true,  'inPriceZone(0.65) = true（边界包含）');
  assert(s.inPriceZone(0.80) === true,  'inPriceZone(0.80) = true');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
