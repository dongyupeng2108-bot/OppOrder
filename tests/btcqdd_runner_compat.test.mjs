// tests/btcqdd_runner_compat.test.mjs — strategy_runner 接口兼容性测试
import { createRunner } from '../strategies/crypto_binary/strategy_runner.mjs';
import fs from 'fs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

console.log('\n=== btc_15m_maker 配置加载（无 model 字段）===');

{
  const config = JSON.parse(
    fs.readFileSync('strategies/crypto_binary/instances/btc_15m_maker.json', 'utf8')
  );
  // btc_15m_maker.json 没有 model 字段，createRunner 不应崩溃
  let runner = null;
  let error = null;
  try {
    runner = createRunner(config);
  } catch (e) {
    error = e.message;
  }
  assert(error === null, `createRunner 不崩溃（无 model 字段）: ${error || 'ok'}`);
  assert(runner !== null, 'createRunner 返回 runner 对象');
  assert(typeof runner.start === 'function', 'runner.start 是函数');
  assert(typeof runner.stop  === 'function', 'runner.stop 是函数');
}

console.log('\n=== btc_15m 配置加载（有 model 字段）===');

{
  const config = JSON.parse(
    fs.readFileSync('strategies/crypto_binary/instances/btc_15m.json', 'utf8')
  );
  let runner = null;
  let error = null;
  try {
    runner = createRunner(config);
  } catch (e) {
    error = e.message;
  }
  assert(error === null, `createRunner 不崩溃（有 model 字段）: ${error || 'ok'}`);
  assert(runner !== null, 'createRunner 返回 runner 对象');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
