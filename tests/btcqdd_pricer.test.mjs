// tests/btcqdd_pricer.test.mjs — volatility_engine + bs_pricer 单元测试

import { calcVolatility } from '../strategies/crypto_binary/volatility_engine.mjs';
import { calcBSPrices } from '../strategies/crypto_binary/bs_pricer.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function assertClose(a, b, tol, label) {
  assert(Math.abs(a - b) < tol, `${label} (got ${a.toFixed(6)}, expected ~${b.toFixed(6)})`);
}

console.log('\n=== volatility_engine 测试 ===');

// 测试 1：基本计算（手工验证结果）
{
  // 5 个价格 → 4 个对数收益率
  const prices = [100, 101, 99, 102, 100];
  const sigma = calcVolatility(prices, 4, 365);
  assert(typeof sigma === 'number' && sigma > 0, '返回正数');
  assert(sigma < 10, 'sigma 在合理范围内（<10）');
}

// 测试 2：价格不变时 sigma 接近 0
{
  const prices = [100, 100, 100, 100, 100];
  const sigma = calcVolatility(prices, 4, 365);
  assertClose(sigma, 0, 1e-10, '等价格序列 sigma ≈ 0');
}

// 测试 3：数据不足抛出错误
{
  try {
    calcVolatility([100], 4, 35040);
    assert(false, '数据不足应抛出错误');
  } catch (e) {
    assert(true, '数据不足正确抛出错误');
  }
}

// 测试 4：负价格抛出错误
{
  try {
    calcVolatility([100, -1, 100, 100, 100], 4, 35040);
    assert(false, '负价格应抛出错误');
  } catch (e) {
    assert(true, '负价格正确抛出错误');
  }
}

console.log('\n=== bs_pricer 测试 ===');

// 测试 5：ATM（S=K，T=1，sigma=0.2，r=0）
// d2 = (0 - 0.5*0.04*1) / (0.2*1) = -0.02/0.2 = -0.1
// pUp = N(-0.1) ≈ 0.4602
{
  const { pUp, pDown, d2 } = calcBSPrices(100, 100, 1, 0.2, 0);
  assertClose(d2, -0.1, 1e-10, 'ATM d2 = -0.1');
  assertClose(pUp, 0.46017, 0.001, 'ATM pUp ≈ 0.4602');
  assertClose(pDown, 0.53983, 0.001, 'ATM pDown ≈ 0.5398');
  assertClose(pUp + pDown, 1.0, 1e-10, 'pUp + pDown = 1');
}

// 测试 6：深度 ITM（S >> K）→ pUp 接近 1
{
  const { pUp } = calcBSPrices(200, 100, 1/365, 0.5, 0);
  assert(pUp > 0.99, '深度 ITM pUp > 0.99');
}

// 测试 7：深度 OTM（S << K）→ pUp 接近 0
{
  const { pUp } = calcBSPrices(50, 100, 1/365, 0.5, 0);
  assert(pUp < 0.01, '深度 OTM pUp < 0.01');
}

// 测试 8：极短剩余时间（T 很小）
{
  const { pUp, pDown } = calcBSPrices(100, 100, 1 / (365 * 24 * 60), 0.8, 0);
  assertClose(pUp + pDown, 1.0, 1e-10, '极短 T 时 pUp + pDown = 1');
}

// 测试 9：无效参数抛出错误
{
  try { calcBSPrices(0, 100, 1, 0.2); assert(false, 'S=0 应抛出'); }
  catch (e) { assert(true, 'S=0 正确抛出错误'); }

  try { calcBSPrices(100, 0, 1, 0.2); assert(false, 'K=0 应抛出'); }
  catch (e) { assert(true, 'K=0 正确抛出错误'); }

  try { calcBSPrices(100, 100, 0, 0.2); assert(false, 'T=0 应抛出'); }
  catch (e) { assert(true, 'T=0 正确抛出错误'); }

  try { calcBSPrices(100, 100, 1, 0); assert(false, 'sigma=0 应抛出'); }
  catch (e) { assert(true, 'sigma=0 正确抛出错误'); }
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
