// tests/btcqdd_scanner.test.mjs — market_scanner 单元测试
import { createScanner } from '../strategies/crypto_binary/market_scanner.mjs';
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

console.log('\n=== createScanner 接口测试 ===');

{
  const scanner = createScanner(config);
  assert(typeof scanner.findCurrentWindow === 'function', 'findCurrentWindow 接口存在');
  assert(typeof scanner.findNextWindow    === 'function', 'findNextWindow 接口存在');
}

console.log('\n=== slug_prefix 配置验证 ===');

{
  const slugPrefix = config.market?.slug_prefix;
  assert(typeof slugPrefix === 'string',           'slug_prefix 是字符串');
  assert(slugPrefix.startsWith('btc-updown-15m-'), `slug_prefix 以 btc-updown-15m- 开头: ${slugPrefix}`);
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
