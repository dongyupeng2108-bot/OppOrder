/**
 * Task1 补充：在**真实 HTTP 服务**上通过 POST /bot/runner/tick 注入与 verify 受控段一致的
 * context（同窗、ATR null→null→非空），采集 state_after，写入 JSONL。
 *
 * 背景：market_scanner 当前不返回 window.atr_5m，纯 GET /bot/context 轮询在现网下往往无法观测
 * 「ATR 从 null 到非空后首段 bounds」。本脚本不修改 bot_runner/bot_state 语义。
 *
 * 用法：
 *   node scripts/collect_anchor_bounds_atr_transition_runtime.mjs [--base_url=http://localhost:53123] [--out=path]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const parseArgs = () => {
  const raw = Object.fromEntries(
    process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=') || 'true'];
    })
  );
  return {
    baseUrl: raw.base_url || 'http://localhost:53123',
    out: raw.out || null
  };
};

const postJson = async (baseUrl, endpoint, payload = {}) => {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parse_error: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
};

const getJson = async (baseUrl, endpoint) => {
  const res = await fetch(`${baseUrl}${endpoint}`);
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parse_error: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, body };
};

const toFinite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const main = async () => {
  const args = parseArgs();
  const outDir = path.join(REPO_ROOT, 'data', 'crypto_binary', 'runtime_samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = args.out || path.join(outDir, `anchor_bounds_atr_transition_tick_${Date.now()}.jsonl`);

  await postJson(args.baseUrl, '/bot/stop', {});

  const cfg = await getJson(args.baseUrl, '/bot/config');
  const atrMult = toFinite(cfg?.body?.current?.atr_multiple) ?? toFinite(cfg?.body?.current?.atr_multiplier) ?? 1.2;

  const wid = `audit-atr-${Date.now()}-w1`;
  const steps = [
    { label: 'T0_anchor_only_atr_null', context_override: { window_id: wid, period: '5m', remaining_sec: 250, btc_price: 100, atr_5m: null } },
    { label: 'T1_same_window_spot_move_atr_still_null', context_override: { window_id: wid, period: '5m', remaining_sec: 230, btc_price: 130, atr_5m: null } },
    { label: 'T2_atr_arrives_bounds_expected', context_override: { window_id: wid, period: '5m', remaining_sec: 210, btc_price: 160, atr_5m: 2 } }
  ];

  const anchorExpect = 100;
  const upExpect = anchorExpect + 2 * atrMult;
  const lowExpect = anchorExpect - 2 * atrMult;

  for (let i = 0; i < steps.length; i += 1) {
    const tick = await postJson(args.baseUrl, '/bot/runner/tick', {
      context_override: steps[i].context_override
    });
    const st = tick.body?.state_after || {};
    const row = {
      ts: new Date().toISOString(),
      kind: 'POST /bot/runner/tick',
      step: steps[i].label,
      tick_index: i,
      http_status: tick.status,
      context_override: steps[i].context_override,
      state_after: {
        current_window_id: st.current_window_id ?? null,
        anchor_btc: st.anchor_btc ?? null,
        atr_5m: st.atr_5m ?? null,
        upper_bound: st.upper_bound ?? null,
        lower_bound: st.lower_bound ?? null,
        window_initialized_at: st.window_initialized_at ?? null
      },
      checks: {
        anchor_frozen_vs_T0: i === 0 ? null : (toFinite(st.anchor_btc) === anchorExpect),
        bounds_match_formula: i === 2
          ? (toFinite(st.upper_bound) === upExpect && toFinite(st.lower_bound) === lowExpect)
          : null
      }
    };
    fs.appendFileSync(outFile, `${JSON.stringify(row)}\n`);
  }

  const statusSnap = await getJson(args.baseUrl, '/bot/status');
  const ctxSnap = await getJson(args.baseUrl, '/bot/context');
  fs.appendFileSync(outFile, `${JSON.stringify({
    ts: new Date().toISOString(),
    kind: 'GET snapshot after tick chain',
    bot_status: statusSnap,
    bot_context: ctxSnap
  })}\n`);

  console.log(`collect_anchor_bounds_atr_transition_runtime: wrote ${steps.length + 1} records to ${path.relative(REPO_ROOT, outFile)}`);
  console.log(JSON.stringify({ ok: true, outFile: path.relative(REPO_ROOT, outFile), atr_multiple_used: atrMult, anchor_expect: anchorExpect, upper_expect: upExpect, lower_expect: lowExpect }));
};

main().catch((e) => {
  console.error('collect_anchor_bounds_atr_transition_runtime: FAIL', e.message);
  process.exit(1);
});
