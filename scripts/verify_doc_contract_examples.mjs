/**
 * 校验 docs/examples 下 Bot 契约示例 JSON：
 * - 可解析
 * - 含 BOT_HTTP_CONTRACT.md 约定的顶层键（最小集）
 *
 * 不启动 HTTP 服务；不替代 verify_* 业务测试。
 * （TEST-light：仅示例结构校验，详见 docs/DELIVERY_REPORT_DOC_GOVERNANCE.md）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'docs', 'examples');

const CONTEXT_KEYS = [
  'window_id',
  'btc_price',
  'anchor_btc',
  'atr_5m',
  'upper_bound',
  'lower_bound',
  'bid_yes',
  'bid_no',
  'stale',
  'updated_at',
  '_btc_source_trace'
];

const STATUS_KEYS = [
  'mode',
  'phase',
  'running',
  'current_window_id',
  'window_initialized_at',
  'anchor_btc',
  'atr_5m',
  'upper_bound',
  'lower_bound',
  'saved_config',
  'last_run_snapshot',
  'active_runtime_snapshot'
];

function assertKeys(obj, keys, label) {
  const missing = keys.filter((k) => !(k in obj));
  if (missing.length) {
    throw new Error(`${label}: missing keys: ${missing.join(', ')}`);
  }
}

function main() {
  const ctxPath = path.join(EXAMPLES, 'bot_context.example.json');
  const stPath = path.join(EXAMPLES, 'bot_status.example.json');

  for (const p of [ctxPath, stPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`missing file: ${p}`);
    }
  }

  const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
  const st = JSON.parse(fs.readFileSync(stPath, 'utf8'));

  assertKeys(ctx, CONTEXT_KEYS, 'bot_context.example.json');
  assertKeys(st, STATUS_KEYS, 'bot_status.example.json');

  if (typeof ctx._btc_source_trace !== 'object' || ctx._btc_source_trace === null) {
    throw new Error('bot_context: _btc_source_trace must be object');
  }
  const ar = ctx._btc_source_trace.atr_resolution;
  if (typeof ar !== 'object' || ar === null) {
    throw new Error('bot_context: _btc_source_trace.atr_resolution must be object');
  }
  for (const k of ['window_atr_5m_raw', 'window_atr_raw', 'state_atr_5m_raw', 'resolved_atr_5m']) {
    if (!(k in ar)) {
      throw new Error(`bot_context: atr_resolution missing key: ${k}`);
    }
  }
  const pr = ctx._btc_source_trace.price_resolution;
  if (typeof pr !== 'object' || pr === null) {
    throw new Error('bot_context: _btc_source_trace.price_resolution must be object');
  }
  for (const k of ['kind', 'used_strike_raw', 'used_anchor_fallback_raw']) {
    if (!(k in pr)) {
      throw new Error(`bot_context: price_resolution missing key: ${k}`);
    }
  }

  console.log('verify_doc_contract_examples: PASS');
  console.log(`  ${path.relative(ROOT, ctxPath)}`);
  console.log(`  ${path.relative(ROOT, stPath)}`);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('verify_doc_contract_examples: FAIL', e.message);
  process.exit(1);
}
