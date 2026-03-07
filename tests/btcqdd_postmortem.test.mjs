// tests/btcqdd_postmortem.test.mjs — postmortem + paper_executor 单元测试
// 不依赖网络，使用内存 SQLite

import { createPaperExecutor } from '../shared/trading/paper_executor.mjs';
import { initPostmortem, recordPostmortem, queryPostmortem } from '../strategies/crypto_binary/postmortem.mjs';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

console.log('\n=== PaperExecutor 测试 ===');

// T1: 正常成交
{
  const executor = createPaperExecutor(config);
  const signal = {
    direction: 'UP', token_id: 'tok_up', ask: 0.55,
    edge_net: 0.05, p_theory: 0.62, fee_est: 0.02,
    slippage_est: 0.005, basis_buffer: 0.01, spread: 0.03,
    created_at: new Date()
  };
  const fill = executor.execute(signal);
  assert(fill.filled === true, 'execute: filled=true');
  assert(fill.fill_price === 0.55, 'execute: fill_price=ask');
  assert(fill.direction === 'UP', 'execute: direction=UP');
  assert(fill.fill_amount_usd === config.risk.max_position_usd, `execute: fill_amount_usd=${config.risk.max_position_usd}`);
}

// T2: settle 胜出
{
  const executor = createPaperExecutor(config);
  const signal = { direction: 'UP', token_id: 'tok_up', ask: 0.55, edge_net: 0.05, p_theory: 0.62, fee_est: 0.02, slippage_est: 0.005, basis_buffer: 0.01, spread: 0.03, created_at: new Date() };
  const fill = executor.execute(signal);
  const pnl = executor.settle(fill, 'UP');
  assert(pnl > 0, `settle 胜出: pnl=${pnl.toFixed(4)} > 0`);
}

// T3: settle 败出
{
  const executor = createPaperExecutor(config);
  const signal = { direction: 'UP', token_id: 'tok_up', ask: 0.55, edge_net: 0.05, p_theory: 0.62, fee_est: 0.02, slippage_est: 0.005, basis_buffer: 0.01, spread: 0.03, created_at: new Date() };
  const fill = executor.execute(signal);
  const pnl = executor.settle(fill, 'DOWN');
  assert(pnl < 0, `settle 败出: pnl=${pnl.toFixed(4)} < 0`);
}

// T4: max_open_orders 限制
{
  const executor = createPaperExecutor(config);
  const signal = { direction: 'UP', token_id: 'tok_up', ask: 0.55, edge_net: 0.05, p_theory: 0.62, fee_est: 0.02, slippage_est: 0.005, basis_buffer: 0.01, spread: 0.03, created_at: new Date() };
  executor.execute(signal); // 第一次成交
  const fill2 = executor.execute(signal); // 第二次应被拒绝（max_open_orders=1）
  assert(fill2.filled === false, 'max_open_orders: 第二次被拒绝');
}

console.log('\n=== postmortem DB 测试 ===');

// T5: initPostmortem 不报错
{
  try {
    await initPostmortem();
    assert(true, 'initPostmortem 不报错');
  } catch (e) {
    assert(false, `initPostmortem 异常: ${e.message}`);
  }
}

// T6: recordPostmortem + queryPostmortem
{
  try {
    await recordPostmortem({
      strategy_id: 'btc_15m_test',
      event_id: 'test_event_001',
      window_start: new Date('2026-03-07T00:00:00Z'),
      window_end: new Date('2026-03-07T00:15:00Z'),
      direction: 'UP',
      signal_edge_net: 0.05,
      p_theory: 0.62,
      ask_at_signal: 0.55,
      fee_est: 0.02,
      K_strike: 84000,
      K_binance: 83990,
      S_at_signal: 84100,
      sigma: 0.38,
      paper_fill_price: 0.55,
      paper_pnl: 3.64,
      symbol: null, // 不发网络请求
    });
    const rows = await queryPostmortem('btc_15m_test', 5);
    assert(rows.length >= 1, `queryPostmortem 返回 ${rows.length} 条`);
    assert(rows[0].event_id === 'test_event_001', 'queryPostmortem event_id 匹配');
    assert(rows[0].paper_pnl === 3.64, 'queryPostmortem paper_pnl 匹配');
  } catch (e) {
    assert(false, `recordPostmortem/queryPostmortem 异常: ${e.message}`);
  }
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
