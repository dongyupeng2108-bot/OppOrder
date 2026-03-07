// tests/btcqdd_sniper.test.mjs — sniper_strategy 单元测试

import { createSniperStrategy } from '../strategies/crypto_binary/sniper_strategy.mjs';
import { createOrderManager } from '../strategies/crypto_binary/order_manager.mjs';
import { createCancelEngine } from '../strategies/crypto_binary/cancel_engine.mjs';
import fs from 'fs';

const base = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8'));
const config = {
  ...base,
  strategy: {
    ...base.strategy,
    sniper_max_price: 0.12,
    sniper_offset: 0.02,
    opposite_min_price: 0.85,
    order_tranches: 1,
    tranche_spread: 0.5,
    tranche_weights: [1.0],
  },
  regime: { min_score: 0.0, max_score: 0.6 },
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
  const cancelEngine = createCancelEngine(config, orderManager);
  return { orderManager, cancelEngine };
}

const windowEnd = new Date(Date.now() + 300 * 1000);

console.log('\n=== S2 触发条件测试 ===');

{
  // UP 侧极端低价 + DOWN 侧高价 → 触发 UP 侧挂单
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.10,   // <= sniper_max_price(0.12) ✓
    ask_down: 0.90, // >= opposite_min_price(0.85) ✓
    bid_up: 0.09, bid_down: 0.88,
    mid_up: 0.095, mid_down: 0.89,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };
  const { actions } = strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  const hasPlace = actions.some(a => a.startsWith('PLACE_UP'));
  assert(hasPlace, `UP 低价触发挂单: ${actions[0]}`);
  assert(deps.orderManager.getOpenOrders().length === 1, '产出 1 个 OPEN 挂单');
}

{
  // DOWN 侧极端低价 + UP 侧高价 → 触发 DOWN 侧挂单
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.91,   // >= opposite_min_price(0.85) ✓
    ask_down: 0.08, // <= sniper_max_price(0.12) ✓
    bid_up: 0.89, bid_down: 0.07,
    mid_up: 0.90, mid_down: 0.075,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };
  const { actions } = strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  const hasPlace = actions.some(a => a.startsWith('PLACE_DOWN'));
  assert(hasPlace, `DOWN 低价触发挂单: ${actions[0]}`);
}

console.log('\n=== 未触发条件测试 ===');

{
  // ask_up=0.50，不满足 <= 0.12 → 不触发
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.50, ask_down: 0.50,
    bid_up: 0.49, bid_down: 0.49,
    mid_up: 0.495, mid_down: 0.495,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };
  const { actions } = strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  const isWaiting = actions.some(a => a.startsWith('WAIT'));
  assert(isWaiting, `ask=0.50 不触发: ${actions[0]}`);
}

{
  // ask_up=0.10 但对面侧 ask_down=0.70 < opposite_min_price(0.85) → 不触发
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.10, ask_down: 0.70,
    bid_up: 0.09, bid_down: 0.68,
    mid_up: 0.095, mid_down: 0.69,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };
  const { actions } = strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  const isWaiting = actions.some(a => a.startsWith('WAIT'));
  assert(isWaiting, `对面侧 ask=0.70 < 0.85，不触发: ${actions[0]}`);
}

console.log('\n=== regime_score 控制测试 ===');

{
  // regime_score=0.7 > max_score=0.6 → 休眠
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.10, ask_down: 0.90,
    bid_up: 0.09, bid_down: 0.88,
    mid_up: 0.095, mid_down: 0.89,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };
  const { actions } = strategy.onMarketData({ snapshot, regime_score: 0.7, sigma: 0.3, windowEnd });
  assert(actions[0].startsWith('SLEEP'), `regime_score=0.7 > 0.6，休眠: ${actions[0]}`);
}

console.log('\n=== 重复挂单防护测试 ===');

{
  // 已有 OPEN 挂单时不重复挂
  const deps = makeDeps();
  const strategy = createSniperStrategy(config, deps);
  const snapshot = {
    ask_up: 0.10, ask_down: 0.90,
    bid_up: 0.09, bid_down: 0.88,
    mid_up: 0.095, mid_down: 0.89,
    tick_size: 0.01, tick_size_changed: false,
    up_token_id: 'tok_up', down_token_id: 'tok_down',
  };

  strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  assert(deps.orderManager.getOpenOrders().length === 1, '第一次挂单: 1 个 OPEN');

  strategy.onMarketData({ snapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  assert(deps.orderManager.getOpenOrders().length === 1, '第二次调用不重复挂单: 仍 1 个 OPEN');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
