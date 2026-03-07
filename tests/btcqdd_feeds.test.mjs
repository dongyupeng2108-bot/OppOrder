// tests/btcqdd_feeds.test.mjs — price_feed + market_scanner 集成测试
// 注意：这些测试会发起真实网络请求，需要网络连接

import { createPriceFeed } from '../strategies/crypto_binary/price_feed.mjs';
import { createScanner } from '../strategies/crypto_binary/market_scanner.mjs';
import fs from 'fs';

// 加载 btc_15m 配置
const config = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8'));

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

console.log('\n=== price_feed 测试 ===');

// T1: getCurrentPrice 返回正数
{
  const feed = createPriceFeed(config);
  try {
    const price = await feed.getCurrentPrice();
    assert(typeof price === 'number' && price > 0, `getCurrentPrice 返回正数（${price}）`);
  } catch (e) {
    assert(false, `getCurrentPrice 异常: ${e.message}`);
  }
}

// T2: getKlines 返回数组，长度接近 kline_limit，元素为正数
{
  const feed = createPriceFeed(config);
  try {
    const klines = await feed.getKlines();
    assert(Array.isArray(klines) && klines.length > 0, `getKlines 返回非空数组（${klines.length} 条）`);
    assert(klines.every(k => typeof k === 'number' && k > 0), 'getKlines 所有元素为正数');
    assert(klines.length <= config.price_feed.kline_limit, `klines 长度 <= kline_limit（${config.price_feed.kline_limit}）`);
  } catch (e) {
    assert(false, `getKlines 异常: ${e.message}`);
  }
}

// T3: startPolling / stopPolling 不抛出错误
{
  const feed = createPriceFeed(config);
  try {
    let pollCount = 0;
    feed.startPolling((price) => { pollCount++; });
    await new Promise(r => setTimeout(r, 3000)); // 等 3 秒
    feed.stopPolling();
    assert(pollCount >= 1, `startPolling 在 3s 内触发至少 1 次（实际 ${pollCount} 次）`);
  } catch (e) {
    assert(false, `startPolling 异常: ${e.message}`);
  }
}

console.log('\n=== market_scanner 测试 ===');

// T4: findCurrentWindow 返回 null 或有效 Window 对象
{
  const scanner = createScanner(config);
  try {
    const win = await scanner.findCurrentWindow();
    if (win === null) {
      assert(true, 'findCurrentWindow 返回 null（当前无活跃窗口，可能在窗口切换期间）');
    } else {
      assert(typeof win.event_id === 'string', 'window.event_id 为字符串');
      assert(typeof win.up_token_id === 'string', 'window.up_token_id 为字符串');
      assert(typeof win.down_token_id === 'string', 'window.down_token_id 为字符串');
      assert(win.window_start instanceof Date, 'window.window_start 为 Date');
      assert(win.window_end instanceof Date, 'window.window_end 为 Date');
      assert(win.window_end > win.window_start, 'window_end > window_start');
      console.log(`  ℹ️  当前窗口: ${win.event_id}, end: ${win.window_end.toISOString()}`);
    }
  } catch (e) {
    assert(false, `findCurrentWindow 异常: ${e.message}`);
  }
}

// T5: findNextWindow 返回 null 或有效 Window 对象，且 start > now
{
  const scanner = createScanner(config);
  try {
    const win = await scanner.findNextWindow();
    if (win === null) {
      assert(true, 'findNextWindow 返回 null（无下一窗口，可正常情况）');
    } else {
      assert(win.window_start > new Date(), 'nextWindow.window_start 在未来');
      console.log(`  ℹ️  下一窗口: ${win.event_id}, start: ${win.window_start.toISOString()}`);
    }
  } catch (e) {
    assert(false, `findNextWindow 异常: ${e.message}`);
  }
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
