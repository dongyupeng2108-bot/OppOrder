// tests/btcqdd_order_manager.test.mjs — order_manager 单元测试
// 不依赖网络

import { createOrderManager } from '../strategies/crypto_binary/order_manager.mjs';
import fs from 'fs';

const baseConfig = JSON.parse(
  fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8')
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

// 单档配置
const singleConfig = {
  ...baseConfig,
  strategy: { order_tranches: 1, tranche_spread: 0.5, tranche_weights: [1.0] },
  paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
};

// 三档配置
const multiConfig = {
  ...baseConfig,
  strategy: {
    order_tranches: 3,
    tranche_spread: 0.5,
    tranche_weights: [0.4, 0.35, 0.25],
  },
  paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
};

console.log('\n=== 单档挂单测试 ===');

{
  const mgr = createOrderManager(singleConfig);
  const orders = mgr.placeOrders({
    side: 'UP', token_id: 'tok_up',
    mid_price: 0.50, offset: 0.02, tick_size: 0.01,
  });
  assert(orders.length === 1, `单档产出 1 个挂单`);
  assert(orders[0].price === 0.48, `price = mid - offset = 0.48`);
  assert(orders[0].size === singleConfig.risk.max_position_usd, `size = max_position_usd`);
  assert(orders[0].tranche_index === 0, `tranche_index = 0`);
  assert(orders[0].status === 'OPEN', `status = OPEN`);
}

console.log('\n=== 三档挂单测试 ===');

{
  const mgr = createOrderManager(multiConfig);
  const orders = mgr.placeOrders({
    side: 'DOWN', token_id: 'tok_down',
    mid_price: 0.50, offset: 0.02, tick_size: 0.01,
  });
  assert(orders.length === 3, `三档产出 3 个挂单`);
  // 档位价格：mid - offset*1.0, mid - offset*1.5, mid - offset*2.0
  assert(orders[0].price === 0.48, `第1档 price=0.48`);
  assert(orders[1].price === 0.46, `第2档 price=0.46 (fp floor)`);
  assert(orders[2].price === 0.46, `第3档 price=0.46`);
  // 仓位分配
  const totalUsd = multiConfig.risk.max_position_usd;
  assert(Math.abs(orders[0].size - totalUsd * 0.4) < 0.001, `第1档 size=40%`);
  assert(Math.abs(orders[1].size - totalUsd * 0.35) < 0.001, `第2档 size=35%`);
  assert(Math.abs(orders[2].size - totalUsd * 0.25) < 0.001, `第3档 size=25%`);
}

console.log('\n=== 撤单 + 延迟埋点测试 ===');

{
  const mgr = createOrderManager(singleConfig);
  const orders = mgr.placeOrders({
    side: 'UP', token_id: 'tok_up',
    mid_price: 0.50, offset: 0.02, tick_size: 0.01,
  });
  mgr.cancelOrder(orders[0].order_id);
  assert(orders[0].status === 'CANCELLED', `撤单后 status=CANCELLED`);
  assert(orders[0].cancel_issued_at instanceof Date, `cancel_issued_at 已记录`);
}

console.log('\n=== cancelAll 测试 ===');

{
  const mgr = createOrderManager(multiConfig);
  mgr.placeOrders({ side: 'UP', token_id: 'tok_up', mid_price: 0.50, offset: 0.02, tick_size: 0.01 });
  mgr.placeOrders({ side: 'DOWN', token_id: 'tok_down', mid_price: 0.50, offset: 0.02, tick_size: 0.01 });
  const cancelled = mgr.cancelAll('tick_size_change');
  assert(cancelled.length === 6, `cancelAll 撤销 6 个挂单（三档×两侧）`);
  assert(mgr.getOpenOrders().length === 0, `cancelAll 后无 OPEN 挂单`);
}

console.log('\n=== markAllStale 测试 ===');

{
  const mgr = createOrderManager(singleConfig);
  mgr.placeOrders({ side: 'UP', token_id: 'tok_up', mid_price: 0.50, offset: 0.02, tick_size: 0.01 });
  mgr.markAllStale();
  const open = mgr.getOpenOrders();
  assert(open.length === 0, `markAllStale 后无 OPEN 挂单`);
  assert(mgr.getAllOrders()[0].status === 'STALE', `挂单状态为 STALE`);
}

console.log('\n=== 乐观 fill 模拟测试 ===');

{
  const mgr = createOrderManager(singleConfig);
  const orders = mgr.placeOrders({
    side: 'UP', token_id: 'tok_up',
    mid_price: 0.50, offset: 0.02, tick_size: 0.01,
  });
  // 构造触价快照（ask_up <= order.price）
  const snapshot = { ask_up: 0.47, ask_down: 0.55 };
  const filled = mgr.simulateFills(snapshot);
  assert(filled.length === 1, `乐观模式触价成交 1 个`);
  assert(orders[0].status === 'FILLED', `status=FILLED`);
}

console.log('\n=== 未触价不成交测试 ===');

{
  const mgr = createOrderManager(singleConfig);
  mgr.placeOrders({
    side: 'UP', token_id: 'tok_up',
    mid_price: 0.50, offset: 0.02, tick_size: 0.01,
  });
  // ask_up > order.price → 未触价
  const snapshot = { ask_up: 0.52, ask_down: 0.55 };
  const filled = mgr.simulateFills(snapshot);
  assert(filled.length === 0, `未触价不成交`);
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
