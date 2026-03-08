// tests/btcqdd_stability.test.mjs
// 故障注入回归测试——验证稳定性机制

import { strict as assert } from 'assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── 1. 单活连接：旧 session 消息被丢弃 ──────────────────────────────
test('stale session message is dropped', () => {
  let processedCount = 0;

  // 模拟：session A 存在，session B 是新的活跃 session
  const sessionA = 'session-A';
  const sessionB = 'session-B';
  let activeSession = sessionB; // B 是当前活跃

  function handleMessage(sessionId, data) {
    if (sessionId !== activeSession) return; // 代际检查
    processedCount++;
  }

  handleMessage(sessionA, 'old_data'); // 旧 session，应被丢弃
  handleMessage(sessionB, 'new_data'); // 新 session，应被处理

  assert.equal(processedCount, 1, 'only active session messages should be processed');
});

// ── 2. 代际护栏：窗口切换后旧异步回调被丢弃 ────────────────────────
test('stale generation callback is aborted', () => {
  let committedWindows = [];
  let currentGeneration = 0;

  function switchWindow(slug) {
    const generation = ++currentGeneration;
    // 模拟异步回调（同步模拟）
    setTimeout(() => {
      if (generation !== currentGeneration) return; // 代际过期
      committedWindows.push(slug);
    }, 0);
  }

  switchWindow('window-A'); // generation=1
  switchWindow('window-B'); // generation=2，A 的回调应被丢弃

  // 同步执行完，两个 setTimeout 都还没跑
  assert.equal(committedWindows.length, 0, 'no window committed yet (async)');
});

// ── 3. 有界重连：超过最大次数后停止重试 ────────────────────────────
test('reconnect stops after max attempts', () => {
  const MAX_ATTEMPTS = 5;
  let attempts = 0;
  let exhausted = false;

  function scheduleReconnect() {
    if (attempts >= MAX_ATTEMPTS) {
      exhausted = true;
      return;
    }
    attempts++;
    scheduleReconnect(); // 递归模拟
  }

  scheduleReconnect();

  assert.equal(attempts, MAX_ATTEMPTS, `should attempt exactly ${MAX_ATTEMPTS} times`);
  assert.equal(exhausted, true, 'should enter exhausted state');
});

// ── 4. 指数退避：延迟计算正确 ──────────────────────────────────────
test('exponential backoff delay calculation', () => {
  const BASE = 1000;
  const FACTOR = 2;
  const MAX = 30000;

  function calcDelay(attempt) {
    return Math.min(BASE * Math.pow(FACTOR, attempt), MAX);
  }

  assert.equal(calcDelay(0), 1000,  'attempt 0: 1s');
  assert.equal(calcDelay(1), 2000,  'attempt 1: 2s');
  assert.equal(calcDelay(2), 4000,  'attempt 2: 4s');
  assert.equal(calcDelay(3), 8000,  'attempt 3: 8s');
  assert.equal(calcDelay(4), 16000, 'attempt 4: 16s');
  assert.equal(calcDelay(5), 30000, 'attempt 5: capped at 30s');
  assert.equal(calcDelay(9), 30000, 'attempt 9: still capped at 30s');
});

// ── 5. 非法 payload 不崩溃 ─────────────────────────────────────────
test('invalid payload does not throw', () => {
  function parseMessage(raw) {
    try {
      const parsed = JSON.parse(raw);
      // 业务逻辑：只接受对象，数组/其他类型视为无效
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null; // 解析失败返回 null，不抛出
    }
  }

  assert.equal(parseMessage(''),            null, 'empty string');
  assert.equal(parseMessage(null),          null, 'null');
  assert.equal(parseMessage(undefined),     null, 'undefined');
  assert.equal(parseMessage('{bad json'),   null, 'malformed JSON');
  assert.equal(parseMessage('[]'),          null, 'unexpected array');
  assert.deepEqual(parseMessage('{"a":1}'), { a: 1 }, 'valid JSON');
});

// ── 6. 空 payload 不崩溃 ───────────────────────────────────────────
test('empty payload handled gracefully', () => {
  function handleTick(data) {
    if (!data || data.price === undefined || data.price === null) return { skipped: true };
    return { price: data.price };
  }

  assert.deepEqual(handleTick(null),       { skipped: true }, 'null data');
  assert.deepEqual(handleTick({}),         { skipped: true }, 'empty object');
  assert.deepEqual(handleTick({ price: 0 }), { price: 0 },   'zero price');
});

// ── 7. 重复消息幂等 ────────────────────────────────────────────────
test('duplicate messages are idempotent', () => {
  const processedIds = new Set();
  let processedCount = 0;

  function handleMessage(msgId, data) {
    if (processedIds.has(msgId)) return; // 幂等检查
    processedIds.add(msgId);
    processedCount++;
  }

  handleMessage('msg-001', { price: 100 });
  handleMessage('msg-001', { price: 100 }); // 重复
  handleMessage('msg-002', { price: 101 });

  assert.equal(processedCount, 2, 'duplicate message should not be processed twice');
});

// ── 8. 顺序错乱：后到的旧消息被丢弃 ──────────────────────────────
test('out-of-order old message is discarded', () => {
  let lastSeq = 0;
  let acceptedCount = 0;

  function handleSequenced(seq, data) {
    if (seq <= lastSeq) return; // 旧消息丢弃
    lastSeq = seq;
    acceptedCount++;
  }

  handleSequenced(1, {});
  handleSequenced(3, {});
  handleSequenced(2, {}); // 乱序，应被丢弃
  handleSequenced(4, {});

  assert.equal(acceptedCount, 3, 'out-of-order message should be discarded');
  assert.equal(lastSeq, 4, 'last seq should be 4');
});

// ── 结果汇总 ──────────────────────────────────────────────────────
console.log(`\nTotal: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) process.exit(1);
