// tests/btcqdd_pmws.test.mjs — Polymarket WebSocket 客户端单元测试
// 不依赖网络，测试接口、状态管理、delta 处理逻辑

import { createPmWsClient } from '../strategies/crypto_binary/pm_ws_client.mjs';
import { createOrderbookMonitor, inferTickSize, floorToTick } from '../strategies/crypto_binary/orderbook_monitor.mjs';
import fs from 'fs';

const config = JSON.parse(
  fs.readFileSync('strategies/crypto_binary/instances/btc_15m_maker.json', 'utf8')
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

console.log('\n=== pm_ws_client 接口测试 ===');

{
  const client = createPmWsClient();
  assert(typeof client.connect             === 'function', 'connect 接口存在');
  assert(typeof client.disconnect          === 'function', 'disconnect 接口存在');
  assert(typeof client.updateSubscription  === 'function', 'updateSubscription 接口存在');
  assert(typeof client.on                  === 'function', 'on 接口存在');
  assert(typeof client.isConnected         === 'function', 'isConnected 接口存在');
  assert(client.isConnected() === false,                   '初始状态未连接');
}

console.log('\n=== orderbook_monitor 接口测试 ===');

{
  const monitor = createOrderbookMonitor(config);
  assert(typeof monitor.start           === 'function', 'start 接口存在');
  assert(typeof monitor.stop            === 'function', 'stop 接口存在');
  assert(typeof monitor.subscribe       === 'function', 'subscribe 接口存在');
  assert(typeof monitor.setTokenIds     === 'function', 'setTokenIds 接口存在');
  assert(typeof monitor.getLatestSnapshot === 'function', 'getLatestSnapshot 接口存在');
  assert(typeof monitor.isStale         === 'function', 'isStale 接口存在');
}

console.log('\n=== inferTickSize / floorToTick 向后兼容测试 ===');

{
  assert(inferTickSize(0.50)  === 0.01,  'inferTickSize(0.50)=0.01');
  assert(inferTickSize(0.97)  === 0.001, 'inferTickSize(0.97)=0.001');
  assert(inferTickSize(0.03)  === 0.001, 'inferTickSize(0.03)=0.001');
  assert(floorToTick(0.475, 0.01)  === 0.47, `floorToTick(0.475, 0.01)=0.47`);
  assert(floorToTick(0.472, 0.01)  === 0.47, `floorToTick(0.472, 0.01)=0.47`);
  assert(floorToTick(0.965, 0.001) === 0.965, `floorToTick(0.965, 0.001)=0.965`);
}

console.log('\n=== stale 标记初始状态测试 ===');

{
  const monitor = createOrderbookMonitor(config);
  assert(monitor.isStale() === false, '初始 stale=false');
  const snap = monitor.getLatestSnapshot();
  assert(snap.stale === false, 'getLatestSnapshot().stale=false');
}

console.log('\n=== rest 模式 / ws 模式均可创建 ===');

{
  const restConfig = { ...config, polymarket_mode: 'rest' };
  const wsConfig   = { ...config, polymarket_mode: 'ws'   };
  const restMonitor = createOrderbookMonitor(restConfig);
  const wsMonitor   = createOrderbookMonitor(wsConfig);
  assert(restMonitor !== null, 'rest 模式可创建');
  assert(wsMonitor   !== null, 'ws 模式可创建');
}

console.log('\n=== subscribe 回调注册测试 ===');

{
  const monitor = createOrderbookMonitor(config);
  let callCount = 0;
  monitor.subscribe(() => callCount++);
  assert(callCount === 0, 'subscribe 注册后未立即调用');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
