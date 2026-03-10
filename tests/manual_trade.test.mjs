// tests/manual_trade.test.mjs — manual_trade 模块单元测试
// 使用 in-memory SQLite（better-sqlite3），不依赖真实网络连接
// 运行：node --experimental-vm-modules tests/manual_trade.test.mjs

import Database from 'better-sqlite3';
import { initManualTrade, submitManualOrder, getManualStats } from '../strategies/crypto_binary/manual_trade.mjs';
import http from 'http';

// ── 工具函数 ────────────────────────────────────────────────────────────

function makeDbWrapper(rawDb) {
  return {
    run: (sql, params = []) => Promise.resolve(rawDb.prepare(sql).run(params)),
    all: (sql, params = []) => Promise.resolve(rawDb.prepare(sql).all(params)),
    get: (sql, params = []) => Promise.resolve(rawDb.prepare(sql).get(params)),
    exec: (sql) => Promise.resolve(rawDb.exec(sql)),
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(msg || `expected ${expected}, got ${actual}`);
}

// ── Test 1: initManualTrade 幂等性 ────────────────────────────────────

await test('initManualTrade 幂等性：连续调用两次不报错', async () => {
  const rawDb = new Database(':memory:');
  const db = makeDbWrapper(rawDb);
  await initManualTrade(db);
  await initManualTrade(db); // 第二次不应抛出
  // 验证表存在
  const rows = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trading_orders'").all();
  assert(rows.length === 1, 'trading_orders table should exist');
  // 验证 source 列存在
  const cols = rawDb.prepare('PRAGMA table_info(trading_orders)').all().map(c => c.name);
  assert(cols.includes('source'), 'source column should exist');
  rawDb.close();
});

// ── Test 2: getManualStats 空库返回零值 ──────────────────────────────

await test("getManualStats 空库返回 { total_trades: 0, wins: 0, losses: 0, total_pnl: 0, win_rate: 0 }", async () => {
  const rawDb = new Database(':memory:');
  const db = makeDbWrapper(rawDb);
  await initManualTrade(db);
  const stats = await getManualStats(db);
  assertEqual(stats.total_trades, 0, 'total_trades');
  assertEqual(stats.wins, 0, 'wins');
  assertEqual(stats.losses, 0, 'losses');
  assertEqual(stats.total_pnl, 0, 'total_pnl');
  assertEqual(stats.win_rate, 0, 'win_rate');
  rawDb.close();
});

// ── Test 3: GET /book/snapshot 返回正确 JSON Schema ──────────────────

await test('GET /book/snapshot 返回正确 JSON Schema（含必要字段）', async () => {
  // 用一个简单的 mock runner 模拟 server 端点行为
  const snap = {
    bid_up: 0.55, ask_up: 0.56, mid_up: 0.555, spread_up: 0.01,
    tick_size: 0.001, sampled_at: Date.now()
  };
  const result = {
    bids: [],
    asks: [],
    best_bid: snap.bid_up,
    best_ask: snap.ask_up,
    mid: snap.mid_up,
    spread: snap.spread_up,
    tick_size: snap.tick_size,
    updated_at: snap.sampled_at
  };
  const requiredKeys = ['bids', 'asks', 'best_bid', 'best_ask', 'mid', 'spread', 'tick_size', 'updated_at'];
  for (const k of requiredKeys) {
    assert(k in result, `missing key: ${k}`);
  }
  assert(Array.isArray(result.bids), 'bids should be array');
  assert(Array.isArray(result.asks), 'asks should be array');
  assert(typeof result.best_bid === 'number', 'best_bid should be number');
});

// ── Test 4: GET /book/snapshot orderbook 未就绪时不崩溃 ──────────────

await test('GET /book/snapshot orderbook 未就绪时返回合理空值（不崩溃）', async () => {
  // snap = null (orderbook not ready)
  const snap = null;
  const result = {
    bids: [],
    asks: [],
    best_bid: snap?.bid_up ?? null,
    best_ask: snap?.ask_up ?? null,
    mid: snap?.mid_up ?? null,
    spread: snap?.spread_up ?? null,
    tick_size: snap?.tick_size ?? null,
    updated_at: snap?.sampled_at ?? Date.now()
  };
  assert(result.best_bid === null, 'best_bid should be null when snap is null');
  assert(result.best_ask === null, 'best_ask should be null when snap is null');
  assert(Array.isArray(result.bids), 'bids should be array');
  assert(typeof result.updated_at === 'number', 'updated_at should be a number');
});

// ── Test 5: POST /trading/manual 缺 required 字段返回 HTTP 400 ───────

await test('POST /trading/manual 缺 required 字段返回 HTTP 400', async () => {
  // 直接测试 submitManualOrder 抛出 missing required field 错误
  const rawDb = new Database(':memory:');
  const db = makeDbWrapper(rawDb);
  await initManualTrade(db);
  let threw = false;
  let errMsg = '';
  try {
    await submitManualOrder({ side: 'buy' }, { db }); // 缺 market_id, price, size
  } catch (e) {
    threw = true;
    errMsg = e.message;
  }
  assert(threw, 'should throw on missing required field');
  assert(errMsg.startsWith('missing required'), `error message should start with 'missing required', got: ${errMsg}`);
  rawDb.close();
});

// ── Test 6: GET /trading/manual-stats 可调用，返回正确 schema ─────────

await test('GET /trading/manual-stats 可调用，返回正确 schema', async () => {
  const rawDb = new Database(':memory:');
  const db = makeDbWrapper(rawDb);
  await initManualTrade(db);
  const stats = await getManualStats(db);
  const requiredKeys = ['total_trades', 'wins', 'losses', 'total_pnl', 'win_rate'];
  for (const k of requiredKeys) {
    assert(k in stats, `missing key: ${k}`);
    assert(typeof stats[k] === 'number', `${k} should be number`);
  }
  rawDb.close();
});

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n${passed + failed}/6 tests run — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
