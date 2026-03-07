// tests/btcqdd_cancel_engine.test.mjs — cancel_engine 四重触发器单元测试
// 不依赖网络，构造输入强制触发各条件

import { createCancelEngine, CANCEL_REASONS } from '../strategies/crypto_binary/cancel_engine.mjs';
import { createOrderManager } from '../strategies/crypto_binary/order_manager.mjs';
import fs from 'fs';

const config = JSON.parse(
  fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8')
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

// 辅助：创建一个有挂单的 order_manager
function makeManager() {
  const mgr = createOrderManager({
    ...config,
    strategy: { order_tranches: 1, tranche_spread: 0.5, tranche_weights: [1.0] },
    paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
  });
  mgr.placeOrders({ side: 'UP', token_id: 'tok_up', mid_price: 0.50, offset: 0.02, tick_size: 0.01 });
  return mgr;
}

console.log('\n=== 触发器 1：sigma 跳变 ===');

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  // 第一次调用设定基准，不触发
  engine.checkSigma(0.30);
  assert(mgr.getOpenOrders().length === 1, 'sigma 基准设定后挂单仍存在');

  // sigma 从 0.30 → 0.45，变化 50% > threshold(30%)，应触发
  const triggered = engine.checkSigma(0.45);
  assert(triggered === true, `sigma 跳变触发: 0.30 → 0.45 (+50%)`);
  assert(mgr.getOpenOrders().length === 0, 'sigma 触发后挂单被撤销');
}

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);
  engine.checkSigma(0.30);

  // sigma 从 0.30 → 0.32，变化 6.7% < threshold，不触发
  const triggered = engine.checkSigma(0.32);
  assert(triggered === false, 'sigma 小变化不触发');
  assert(mgr.getOpenOrders().length === 1, 'sigma 小变化后挂单保留');
}

console.log('\n=== 触发器 2：时间衰减（tau） ===');

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  // 窗口结束还有 30s < tau_min_sec(60s)，应触发
  const windowEnd = new Date(Date.now() + 30 * 1000);
  const triggered = engine.checkTau(windowEnd);
  assert(triggered === true, 'tau 触发: 30s < 60s');
  assert(mgr.getOpenOrders().length === 0, 'tau 触发后挂单被撤销');
}

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  // 窗口结束还有 120s > tau_min_sec(60s)，不触发
  const windowEnd = new Date(Date.now() + 120 * 1000);
  const triggered = engine.checkTau(windowEnd);
  assert(triggered === false, 'tau 不触发: 120s > 60s');
  assert(mgr.getOpenOrders().length === 1, 'tau 不触发后挂单保留');
}

console.log('\n=== 触发器 3：挂单老化（age） ===');

{
  const mgr = createOrderManager({
    ...config,
    cancel: { ...config.cancel, order_age_max_sec: 0 }, // 设为 0 秒，立即老化
    strategy: { order_tranches: 1, tranche_spread: 0.5, tranche_weights: [1.0] },
    paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 },
  });
  mgr.placeOrders({ side: 'UP', token_id: 'tok_up', mid_price: 0.50, offset: 0.02, tick_size: 0.01 });

  const engine = createCancelEngine(
    { ...config, cancel: { ...config.cancel, order_age_max_sec: 0 } },
    mgr
  );
  // 等待 1ms 确保 age > 0
  await new Promise(r => setTimeout(r, 1));
  const triggered = engine.checkAge();
  assert(triggered === true, 'age 触发: order_age_max_sec=0');
  assert(mgr.getOpenOrders().length === 0, 'age 触发后挂单被撤销');
}

console.log('\n=== 触发器 4：tick_size_change ===');

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  const snapshot = { tick_size_changed: true, tick_size: 0.001 };
  const triggered = engine.onTickSizeChange(snapshot);
  assert(triggered === true, 'tick_size_change 触发');
  assert(mgr.getOpenOrders().length === 0, 'tick_size_change 触发后无 OPEN 挂单');
}

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  const snapshot = { tick_size_changed: false, tick_size: 0.01 };
  const triggered = engine.onTickSizeChange(snapshot);
  assert(triggered === false, 'tick_size 未变更不触发');
  assert(mgr.getOpenOrders().length === 1, 'tick_size 未变更挂单保留');
}

console.log('\n=== check() 综合入口测试 ===');

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);

  // tick_size_change 优先级最高
  const result = engine.check({
    sigma: 0.30,
    windowEnd: new Date(Date.now() + 120 * 1000),
    snapshot: { tick_size_changed: true, tick_size: 0.001 },
  });
  assert(result === CANCEL_REASONS.TICK_SIZE, `check() 返回 TICK_SIZE`);
}

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);
  engine.checkSigma(0.30); // 设基准

  // 无触发条件
  const result = engine.check({
    sigma: 0.31,
    windowEnd: new Date(Date.now() + 120 * 1000),
    snapshot: { tick_size_changed: false },
  });
  assert(result === null, 'check() 无触发返回 null');
}

console.log('\n=== resetSigma 测试 ===');

{
  const mgr = makeManager();
  const engine = createCancelEngine(config, mgr);
  engine.checkSigma(0.30); // 设基准
  engine.resetSigma();
  // reset 后第一次调用只设基准，不触发
  const triggered = engine.checkSigma(0.99); // 极大变化，但因 reset 不触发
  assert(triggered === false, 'resetSigma 后第一次调用不触发');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
