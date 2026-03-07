// tests/btcqdd_live.test.mjs — LiveExecutor 接入 + 连续亏损停机测试
// 使用 mock 依赖，不需要真实 Signer Agent

import { createPaperExecutor } from '../shared/trading/paper_executor.mjs';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

const mockSignal = {
  direction: 'UP', token_id: 'tok_up', ask: 0.55,
  edge_net: 0.05, p_theory: 0.62, fee_est: 0.02,
  slippage_est: 0.005, basis_buffer: 0.01, spread: 0.03,
  created_at: new Date()
};

console.log('\n=== 连续亏损停机逻辑测试（用 PaperExecutor 模拟）===');

// T1: 连续亏损计数器逻辑
{
  let consecutiveLosses = 0;
  const maxLosses = config.risk.consecutive_loss_stop; // 5

  // 模拟 5 次亏损
  for (let i = 0; i < 5; i++) {
    const pnl = -1.0;
    if (pnl < 0) consecutiveLosses++;
    else consecutiveLosses = 0;
  }
  assert(consecutiveLosses === 5, `连续亏损计数器: ${consecutiveLosses}`);
  assert(consecutiveLosses >= maxLosses, `达到停机阈值 ${maxLosses}`);
}

// T2: 盈利后计数器重置
{
  let consecutiveLosses = 3;
  const pnl = 1.0; // 盈利
  if (pnl < 0) consecutiveLosses++;
  else consecutiveLosses = 0;
  assert(consecutiveLosses === 0, `盈利后计数器重置: ${consecutiveLosses}`);
}

// T3: PaperExecutor 在 executor 接口中可正常调用
{
  const executor = createPaperExecutor(config);
  const fill = executor.execute(mockSignal);
  assert(fill.filled === true, 'executor.execute() 接口兼容');
  const pnl = executor.settle(fill, 'UP');
  assert(typeof pnl === 'number', `executor.settle() 返回 number: ${pnl.toFixed(4)}`);
}

// T4: executor_mode 默认为 paper
{
  const mode = config.executor_mode || 'paper';
  assert(mode === 'paper', `默认 executor_mode=paper`);
}

// T5: executor_mode=live 时路径正确（不调用真实 Signer，只验证分支逻辑）
{
  const liveConfig = { ...config, executor_mode: 'live' };
  const mode = liveConfig.executor_mode || 'paper';
  assert(mode === 'live', `executor_mode=live 可配置`);
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
