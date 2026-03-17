import fs from 'fs';
// BTCQDD 独立服务入口
// 端口 53123（默认），支持 --strategy=<id> 和 --port=<n> 参数
// 提供：GET / 健康检查，POST /config/reload 热更新

import { createServer } from 'http';
import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync, createReadStream, statSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  startInstance,
  stopInstance,
  reloadInstance,
  getStatus as smGetStatus,
  getRunner,
  getActiveRunner,
  updateHeartbeat,
} from './strategy_manager.mjs';
import { initPostmortem } from './postmortem.mjs';
import { logger, EVENTS } from './logger.mjs';
import { getDb } from './db.mjs';
import { initManualTrade, submitManualOrder, getManualStats } from './manual_trade.mjs';
import { publish, subscribe, unsubscribe, EVENT_TYPES } from './event_bus.mjs';
import { getAttribution, getLossModes, getSensitivity, getDistribution, getCompare } from './postmortem_api.mjs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createScanner } from './market_scanner.mjs';
import { createOrderbookMonitor } from './orderbook_monitor.mjs';
import * as strategyRunnerSe from './strategy_runner_se.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 代理感知 fetch（用于 /klines 等需要翻墙的端点）
const _klinesProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const _klinesDispatcher = _klinesProxyUrl ? new ProxyAgent(_klinesProxyUrl) : null;
async function _proxyFetch(url, opts = {}) {
  if (_klinesDispatcher) return undiciFetch(url, { ...opts, dispatcher: _klinesDispatcher });
  return fetch(url, opts);
}

// 解析命令行参数
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);
const STRATEGY_ID = args.strategy || null;
const PORT = parseInt(args.port || '53123', 10);

// 加载策略配置
function loadConfig(strategyId) {
  const configPath = resolve(__dirname, 'instances', `${strategyId}.json`);
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

logger.info(EVENTS.SERVER_START, {
  module: 'server',
  log_level: process.env.LOG_LEVEL || 'info',
  port: PORT,
  strategy: STRATEGY_ID || 'none',
});

// 供 strategy_runner_se.mjs 动态导入使用
export function getGlobalSnapshot() {
  return _globalOrderbookMonitor?.getLatestSnapshot?.() || null;
}
export function getGlobalRegime() {
  return getActiveRunner()?.getRegimeState?.() || null;
}

// 全局盘口监控（不依赖 runner，服务启动即开始）
let _globalOrderbookMonitor = null;
let _globalScanner          = null;

async function initGlobalOrderbook() {
  try {
    const baseConfig = {
      market: { slug_prefix: 'btc-updown-5m-', window_minutes: 5 },
      polymarket_poll_sec: 2,
      polymarket_mode: 'rest',
    };
    _globalScanner = createScanner(baseConfig);
    global._btcqddGlobalScanner = _globalScanner;
    const win = await _globalScanner.findCurrentWindow();
    if (!win || !win.up_token_id) {
      console.warn('[server] initGlobalOrderbook: no active BTC 5m window found');
      return;
    }
    console.info(`[server] initGlobalOrderbook: window ${win.slug}, up=${win.up_token_id.slice(0,8)}…`);

    // 停止旧的 monitor（防止旧实例继续用过期 token_id 发请求）
    if (_globalOrderbookMonitor) {
      try { _globalOrderbookMonitor.stop(); } catch(_) {}
      _globalOrderbookMonitor = null;
    }

    _globalOrderbookMonitor = createOrderbookMonitor(baseConfig);
    _globalOrderbookMonitor.start(win.up_token_id, win.down_token_id);
    console.info('[server] Global orderbook monitor started');

    // 注入全局快照获取函数，供 strategy_runner_se.mjs 调用
    global._btcqddGetSnapshot = () => _globalOrderbookMonitor?.getLatestSnapshot?.() || null;
    global._btcqddGlobalOrderbook = _globalOrderbookMonitor;
  } catch (err) {
    console.warn('[server] initGlobalOrderbook failed:', err.message);
    // 失败不阻塞服务启动
  }
}

// 监听窗口切换，用新窗口 token_id 重新初始化盘口
subscribe(async (evt) => {
  if (evt.type !== EVENT_TYPES.WINDOW_SWITCH) return;
  
  if (!fs.existsSync('data/crypto_binary/logs')) {
    fs.mkdirSync('data/crypto_binary/logs', { recursive: true });
  }
  const ts = new Date().toISOString();
  fs.appendFileSync('data/crypto_binary/logs/window_switch.log', `${ts} WINDOW_SWITCH received\n`);

  // 先同步保存旧窗口 token_ids（必须在 initGlobalOrderbook 之前）
  if (_globalOrderbookMonitor) {
    global._btcqddLastWindowTokenIds = _globalOrderbookMonitor.getTokenIds?.() || null;
  }

  console.info('[server] WINDOW_SWITCH detected, reinitializing orderbook...');
  await initGlobalOrderbook();

  fs.appendFileSync('data/crypto_binary/logs/window_switch.log', `${ts} initGlobalOrderbook done\n`);
});

let db = null;
(async () => {
  db = await getDb();
  await initPostmortem();
  await initManualTrade(db);
  console.log('[BTCQDD] DB migration completed (initPostmortem + initManualTrade)');

  // 服务启动后异步初始化全局盘口（不阻塞 listen）
  initGlobalOrderbook();

  if (STRATEGY_ID) {
    const result = await startInstance(STRATEGY_ID);
    if (result.ok) {
      logger.info({ module: 'server', strategy: STRATEGY_ID, msg: 'auto-started from --strategy arg' });
    } else {
      logger.error({ module: 'server', strategy: STRATEGY_ID, err: result.error, msg: 'auto-start failed' });
    }
  }

  // 定时轮询检测 regime/window 状态变化 → publish 事件（替代方案，2s 延迟）
  // 所有内部事件发射点均在 scope 外模块，无法直接注入 publish，故采用轮询
  let _lastRegimeScore = null;
  let _lastWindowId = null;
  setInterval(async () => {
    try {
      const activeRunner = getActiveRunner();
      const regimeState = activeRunner ? activeRunner.getRegimeState() : null;
      if (regimeState) {
        const score = regimeState.regime_score ?? null;
        if (_lastRegimeScore !== null && score !== null && Math.abs(score - _lastRegimeScore) > 0.05) {
          publish(EVENT_TYPES.REGIME_CHANGED, { regime_score: score, prev: _lastRegimeScore });
        }
        _lastRegimeScore = score;
      }

      // 用 scanner 直接检测窗口切换（不依赖策略运行器）
      if (_globalScanner) {
        try {
          const win = await _globalScanner.findCurrentWindow();
          const windowId = win?.slug ?? null;
          if (windowId && _lastWindowId !== null && windowId !== _lastWindowId) {
            publish(EVENT_TYPES.WINDOW_SWITCH, { window_id: windowId, prev: _lastWindowId });
          }
          if (windowId) _lastWindowId = windowId;
        } catch (_) {}
      }
    } catch (_) { /* runner not yet ready */ }
  }, 2000);
})().catch(err => {
  logger.error(EVENTS.ERROR_UNHANDLED_PATH, { module: 'server', err: err.message, msg: 'runner failed to start' });
});

// 深度嵌套合并：将 "a.b.c" 形式的扁平键写入嵌套对象
function applyNestedOverrides(target, overrides) {
  const result = JSON.parse(JSON.stringify(target));
  for (const [key, value] of Object.entries(overrides)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let obj = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
          obj[parts[i]] = {};
        }
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function deepMerge(base, patch) {
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])
        && base[key] && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key], patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}

const server = createServer(async (req, res) => {
  // CORS headers for local UI (file:// → localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET / — 健康检查
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      port: PORT,
      strategy: STRATEGY_ID || 'none',
      runner_active: getActiveRunner() !== null
    }));
    return;
  }

  // POST /config/reload — 热更新
  if (req.method === 'POST' && req.url === '/config/reload') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed.name) {
          // 新路径：指定实例 reload
          const result = await reloadInstance(parsed.name);
          sendJson(res, result, result.ok ? 200 : 500);
          return;
        }
        // 旧路径：全局 reload（向后兼容，STRATEGY_ID 必须存在）
        if (!STRATEGY_ID) {
          sendJson(res, { ok: false, error: 'no strategy loaded, use { name } to specify instance' }, 400);
          return;
        }
        const result = await reloadInstance(STRATEGY_ID);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ── UI 专用端点（B1 控制面板）──────────────────────────

  // GET /ui/regime — 当前市场状态评分
  if (req.method === 'GET' && req.url === '/ui/regime') {
    try {
      const ar = getActiveRunner();
      const state = ar ? ar.getRegimeState() : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: state }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/instances — 扫描磁盘 instances 目录，合并运行时状态
  if (req.method === 'GET' && req.url === '/ui/instances') {
    try {
      sendJson(res, { instances: smGetStatus() });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /ui/cancel-stats — 撤单引擎统计
  if (req.method === 'GET' && req.url === '/ui/cancel-stats') {
    try {
      const ar = getActiveRunner();
      const stats = ar ? ar.getCancelStats() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: stats }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/active-orders — 当前活跃挂单
  if (req.method === 'GET' && req.url === '/ui/active-orders') {
    try {
      const ar = getActiveRunner();
      const orders = ar ? ar.getActiveOrders() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: orders }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /book/snapshot — 订单簿快照
  if (req.method === 'GET' && req.url === '/book/snapshot') {
    try {
      const ar = getActiveRunner();
      const monitor = _globalOrderbookMonitor
        || (ar ? { getLatestSnapshot: () => ar.getOrderbookSnapshot() } : null);
      const snap = monitor ? monitor.getLatestSnapshot() : null;
      sendJson(res, {
        bids: snap ? [] : [],
        asks: snap ? [] : [],
        best_bid: snap?.bid_up ?? null,
        best_ask: snap?.ask_up ?? null,
        mid: snap?.mid_up ?? null,
        spread: snap?.spread_up ?? null,
        tick_size: snap?.tick_size ?? null,
        updated_at: snap?.sampled_at ?? Date.now()
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // GET /trading/orders — 订单列表（来自 trading_orders 表）
  if (req.method === 'GET' && req.url === '/trading/orders') {
    try {
      if (!db) { sendJson(res, [], 200); return; }
      const orders = await db.all('SELECT * FROM trading_orders ORDER BY created_at DESC LIMIT 200');
      sendJson(res, orders ?? []);
    } catch {
      sendJson(res, []);
    }
    return;
  }

  // POST /trading/manual — 手动下单
  if (req.method === 'POST' && req.url === '/trading/manual') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body || '{}');
        if (!db) throw new Error('db not ready');
        const result = await submitManualOrder(params, { db });
        sendJson(res, result);
      } catch (e) {
        const status = e.message.startsWith('missing required') ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /trading/manual-stats — 手动交易统计
  if (req.method === 'GET' && req.url === '/trading/manual-stats') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const stats = await getManualStats(db);
      sendJson(res, stats);
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // GET /trading/manual/stats — 带重置过滤的手动交易统计
  if (req.method === 'GET' && req.url === '/trading/manual/stats') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const resetAt = global._manualTradeResetAt || 0;
      const row = await db.get(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(CASE WHEN status='filled' THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END), 0) as losses,
          COALESCE(SUM(CASE WHEN status='filled' THEN COALESCE(pnl,0) ELSE 0 END), 0) as total_pnl
        FROM trading_orders
        WHERE source='manual' AND created_at > ?`,
        [resetAt]
      );
      const r = row || { total_trades: 0, wins: 0, losses: 0, total_pnl: 0 };
      const win_rate = r.total_trades > 0 ? (r.wins || 0) / r.total_trades : 0;
      sendJson(res, { total_trades: r.total_trades || 0, wins: r.wins || 0, losses: r.losses || 0, total_pnl: r.total_pnl || 0, win_rate });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // POST /trading/manual/reset — 软重置手动交易统计
  if (req.method === 'POST' && req.url === '/trading/manual/reset') {
    global._manualTradeResetAt = Date.now();
    sendJson(res, { ok: true, reset_at: new Date(global._manualTradeResetAt).toISOString() });
    return;
  }

  // GET /klines — 转发 Binance REST klines（K 线代理）
  if (req.method === 'GET' && req.url.startsWith('/klines')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const symbol   = params.get('symbol')   || 'BTCUSDT';
    const interval = params.get('interval') || '15m';
    const limit    = parseInt(params.get('limit') || '21', 10);
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
      const resp = await _proxyFetch(url);
      if (!resp.ok) {
        sendJson(res, { ok: false, error: `Binance ${resp.status}` }, 502);
        return;
      }
      const data = await resp.json();
      sendJson(res, { ok: true, klines: data });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // ── 复盘分析端点（UI-M4）──────────────────────────────────

  // GET /postmortem/attribution
  if (req.method === 'GET' && req.url.startsWith('/postmortem/attribution')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _attrUrl = new URL(req.url, 'http://localhost');
      const _attrSid = _attrUrl.searchParams.get('strategy_id') || null;
      if (!_attrSid) {
        sendJson(res, await getAttribution(db));
      } else {
        const regimeBuckets = await db.all(`
          SELECT
            CASE
              WHEN regime_score >= 0.6 THEN 'oscillating'
              WHEN regime_score >= 0.4 THEN 'transitional'
              ELSE 'trending'
            END as regime_bucket,
            COUNT(*) as count,
            COALESCE(SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0
              THEN 1.0 - pair_cost ELSE 0 END), 0) as total_pnl,
            AVG(pair_cost) as avg_cost
          FROM cb_postmortem
          WHERE regime_score IS NOT NULL AND strategy_id = ?
          GROUP BY regime_bucket
          ORDER BY regime_bucket
        `, [_attrSid]);
        const hourBuckets = await db.all(`
          SELECT
            CASE
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 1  AND 7  THEN 'asia'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 7  AND 12 THEN 'europe'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 12 AND 16 THEN 'us_morning'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 16 AND 20 THEN 'us_afternoon'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 20 AND 23 THEN 'us_close'
              ELSE 'overnight'
            END as hour_bucket,
            COUNT(*) as count,
            COALESCE(SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0
              THEN 1.0 - pair_cost ELSE 0 END), 0) as total_pnl
          FROM cb_postmortem
          WHERE window_start IS NOT NULL AND strategy_id = ?
          GROUP BY hour_bucket
          ORDER BY hour_bucket
        `, [_attrSid]);
        sendJson(res, { regime_buckets: regimeBuckets, hour_buckets: hourBuckets });
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/loss-modes
  if (req.method === 'GET' && req.url.startsWith('/postmortem/loss-modes')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _lmUrl = new URL(req.url, 'http://localhost');
      const _lmSid = _lmUrl.searchParams.get('strategy_id') || null;
      if (!_lmSid) {
        sendJson(res, await getLossModes(db));
      } else {
        const modes = await db.all(`
          SELECT
            CASE
              WHEN pair_cost IS NULL        THEN 'unpaired_timeout'
              WHEN pair_cost >= 1.05        THEN 'wrong_direction'
              WHEN pair_cost >= 1.0         THEN 'spread_eaten'
              ELSE                          'other'
            END as loss_mode,
            COUNT(*) as count,
            AVG(pair_cost) as avg_cost,
            MIN(pair_cost) as worst_cost
          FROM cb_postmortem
          WHERE (pair_cost IS NULL OR pair_cost >= 1.0) AND strategy_id = ?
          GROUP BY loss_mode
          ORDER BY count DESC
        `, [_lmSid]);
        const examples = {};
        for (const mode of modes) {
          const ex = await db.get(`
            SELECT id, strategy_id, window_start, window_end, pair_cost, regime_score
            FROM cb_postmortem
            WHERE (
              CASE
                WHEN pair_cost IS NULL        THEN 'unpaired_timeout'
                WHEN pair_cost >= 1.05        THEN 'wrong_direction'
                WHEN pair_cost >= 1.0         THEN 'spread_eaten'
                ELSE                          'other'
              END
            ) = ? AND strategy_id = ?
            ORDER BY id DESC LIMIT 1
          `, [mode.loss_mode, _lmSid]);
          if (ex) examples[mode.loss_mode] = ex;
        }
        sendJson(res, { modes, examples });
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/sensitivity
  if (req.method === 'GET' && req.url.startsWith('/postmortem/sensitivity')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _sensUrl = new URL(req.url, 'http://localhost');
      const _sensSid = _sensUrl.searchParams.get('strategy_id') || null;
      if (!_sensSid) {
        sendJson(res, await getSensitivity(db));
      } else {
        const rows = await db.all(`
          SELECT
            config_hash,
            strategy_id,
            COUNT(*) as total_windows,
            SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0 THEN 1 ELSE 0 END) as wins,
            AVG(pair_cost) as avg_cost,
            AVG(regime_score) as avg_regime,
            MIN(created_at) as first_trade,
            MAX(created_at) as last_trade
          FROM cb_postmortem
          WHERE config_hash IS NOT NULL AND strategy_id = ?
          GROUP BY config_hash, strategy_id
          ORDER BY avg_cost ASC
        `, [_sensSid]);
        sendJson(res, rows);
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/distribution
  if (req.method === 'GET' && req.url === '/postmortem/distribution') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getDistribution(db));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/compare?ids=s1,s2
  if (req.method === 'GET' && req.url.startsWith('/postmortem/compare')) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const ids = (parsedUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    if (ids.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ids query param required' }));
      return;
    }
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getCompare(db, ids));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // ─── POST /strategies/create ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/strategies/create') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, base_config, overrides = {} } = JSON.parse(body || '{}');

        // 参数校验
        if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
          sendJson(res, { ok: false, error: 'name 只允许字母/数字/下划线/连字符，长度 1~64' }, 400);
          return;
        }

        const instancesDir = resolve(__dirname, 'instances');
        const filePath = resolve(instancesDir, `${name}.json`);

        // 防止覆盖已有实例
        if (existsSync(filePath)) {
          sendJson(res, { ok: false, error: `实例 ${name} 已存在` }, 409);
          return;
        }

        // 读取模板（base_config 为已有实例名），不指定则空对象
        let template = {};
        if (base_config) {
          const tplPath = resolve(instancesDir, `${base_config}.json`);
          if (existsSync(tplPath)) {
            template = JSON.parse(readFileSync(tplPath, 'utf8'));
          }
        }

        // 合并参数（支持 "a.b.c" 嵌套键），strategy_id 必须等于实例名
        const newConfig = applyNestedOverrides(template, overrides);
        newConfig.strategy_id = name;

        // 校验必填字段
        if (!newConfig.strategy_id) {
          sendJson(res, { ok: false, error: 'strategy_id is required' }, 400);
          return;
        }
        if (!newConfig.strategy?.type) {
          sendJson(res, { ok: false, error: 'strategy.type is required' }, 400);
          return;
        }

        // 写入文件
        mkdirSync(instancesDir, { recursive: true });
        writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf8');

        // 触发热加载（忽略失败，文件已写入即成功）
        fetch(`http://localhost:${PORT}/config/reload`, { method: 'POST' }).catch(() => {});

        sendJson(res, { ok: true, name, file: `instances/${name}.json` });
      } catch (e) {
        sendJson(res, { ok: false, error: e.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/start — 启动指定实例
  if (req.method === 'POST' && req.url === '/strategies/start') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await startInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/stop — 停止指定实例
  if (req.method === 'POST' && req.url === '/strategies/stop') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await stopInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/reload — 重载指定实例
  if (req.method === 'POST' && req.url.startsWith('/strategies/reload')) {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await reloadInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ─── DELETE /strategies/:name ──────────────────────────────────────────────
  if (req.method === 'DELETE' && /^\/strategies\/[a-zA-Z0-9_-]{1,64}$/.test(req.url)) {
    const name = req.url.slice('/strategies/'.length);
    try {
      const filePath = resolve(__dirname, 'instances', `${name}.json`);
      if (!existsSync(filePath)) {
        sendJson(res, { ok: false, error: `实例 ${name} 不存在` }, 404);
        return;
      }

      unlinkSync(filePath);
      fetch(`http://localhost:${PORT}/config/reload`, { method: 'POST' }).catch(() => {});

      // git rm + commit：彻底从版本历史移除，防止 checkout/restore 复活
      const repoRoot = resolve(__dirname, '..', '..');
      const gitRelPath = `strategies/crypto_binary/instances/${name}.json`;
      try {
        execSync(`git rm --cached --force "${gitRelPath}"`, { cwd: repoRoot, stdio: 'pipe' });
        execSync(`git commit -m "remove instance: ${name}"`, { cwd: repoRoot, stdio: 'pipe' });
        console.info(`[server] instance ${name} removed from git`);
      } catch (gitErr) {
        console.warn(`[server] git rm/commit failed for ${name}:`, gitErr.message);
      }

      sendJson(res, { ok: true, name, deleted: true });
    } catch (e) {
      sendJson(res, { ok: false, error: e.message }, 500);
    }
    return;
  }

  // ─── GET /strategies/:name/config ──────────────────────────────────────────
  {
    const { pathname: pn } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pn.startsWith('/strategies/') && pn.endsWith('/config')) {
      const name = pn.split('/')[2];
      const instancePath = resolve(__dirname, 'instances', `${name}.json`);

      if (!existsSync(instancePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Instance not found: ${name}` }));
        return;
      }

      try {
        const cfg = JSON.parse(readFileSync(instancePath, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // ─── PUT /strategies/:name/config ───────────────────────────────────────────
  {
    const { pathname: pn } = new URL(req.url, 'http://localhost');
    if (req.method === 'PUT' && pn.startsWith('/strategies/') && pn.endsWith('/config')) {
      const name = pn.split('/')[2];
      const instancePath = resolve(__dirname, 'instances', `${name}.json`);

      if (!existsSync(instancePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Instance not found: ${name}` }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const patch = JSON.parse(body);

          // 参数范围校验
          if (patch.strategy) {
            const s = patch.strategy;
            if (s.entry_offset !== undefined && (s.entry_offset < 0.001 || s.entry_offset > 0.2)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'entry_offset must be between 0.001 and 0.2' }));
              return;
            }
            if (s.order_tranches !== undefined && (s.order_tranches < 1 || s.order_tranches > 5)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'order_tranches must be between 1 and 5' }));
              return;
            }
          }

          // 读取现有配置，深度合并 patch
          const existing = JSON.parse(readFileSync(instancePath, 'utf8'));
          const merged = deepMerge(existing, patch);
          writeFileSync(instancePath, JSON.stringify(merged, null, 2), 'utf8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, written: instancePath, name }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ─── GET /strategies/status ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/strategies/status') {
    sendJson(res, { instances: smGetStatus() });
    return;
  }

  // ─── GET /stats — postmortem 聚合统计，支持 group_by 参数 ─────────────────
  if (req.method === 'GET' && req.url.startsWith('/stats')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const parsedUrl = new URL(req.url, 'http://localhost');
      const groupByParam = parsedUrl.searchParams.get('group_by') || 'strategy_id';
      const ALLOWED = ['strategy_id', 'config_hash', 'symbol', 'timeframe', 'strategy_type'];
      const groupKeys = groupByParam.split(',').map(k => k.trim()).filter(k => ALLOWED.includes(k));
      if (groupKeys.length === 0) {
        sendJson(res, { error: 'Invalid group_by fields' }, 400);
        return;
      }
      const selectCols = groupKeys.join(', ');
      const rows = await db.all(`
        SELECT
          ${selectCols},
          COUNT(*) AS count,
          AVG(paper_pnl) AS avg_pnl,
          AVG(CASE WHEN paper_pnl > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
          AVG(pair_cost) AS avg_pair_cost,
          AVG(regime_score) AS avg_regime_score,
          MIN(created_at) AS first_at,
          MAX(created_at) AS last_at
        FROM cb_postmortem
        GROUP BY ${selectCols}
        ORDER BY count DESC
      `);
      sendJson(res, { rows: rows ?? [], total_count: (rows ?? []).reduce((s, r) => s + r.count, 0) });
    } catch (err) {
      console.error('[Stats] Error:', err.message);
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // ── /strategy-runner/* ────────────────────────────────────────────────

  // POST /strategy-runner/deploy
  if (req.method === 'POST' && req.url === '/strategy-runner/deploy') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { code, period } = JSON.parse(body || '{}');
        if (!code) { sendJson(res, { ok: false, error: 'code required' }, 400); return; }
        const result = await strategyRunnerSe.deploy(code, period);
        sendJson(res, result);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /strategy-runner/stop
  if (req.method === 'POST' && req.url === '/strategy-runner/stop') {
    try {
      strategyRunnerSe.stop();
      sendJson(res, { ok: true });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /strategy-runner/code — 读取用户保存的策略代码
  if (req.method === 'GET' && req.url === '/strategy-runner/code') {
    try {
      const codePath = resolve(__dirname, 'instances', 'se_custom_code.js');
      if (fs.existsSync(codePath)) {
        const code = fs.readFileSync(codePath, 'utf-8');
        sendJson(res, { ok: true, code });
      } else {
        sendJson(res, { ok: true, code: null });
      }
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // POST /strategy-runner/code — 保存用户策略代码到服务端文件
  if (req.method === 'POST' && req.url === '/strategy-runner/code') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        if (typeof code !== 'string') {
          sendJson(res, { ok: false, error: 'code field required (string)' }, 400);
          return;
        }
        const codePath = resolve(__dirname, 'instances', 'se_custom_code.js');
        fs.writeFileSync(codePath, code, 'utf-8');
        sendJson(res, { ok: true, saved: codePath });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // GET /strategy-runner/status
  if (req.method === 'GET' && req.url === '/strategy-runner/status') {
    try {
      const status = strategyRunnerSe.getStatus();
      
      // Inject window.remaining_sec
      let remaining_sec = null;
      if (_globalScanner) {
        try {
          const win = await _globalScanner.findCurrentWindow();
          if (win?.end_date) {
            remaining_sec = Math.max(0, Math.floor((new Date(win.end_date) - Date.now()) / 1000));
          }
        } catch(_) {}
      }
      status.window = { remaining_sec };
      
      sendJson(res, status);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /strategy-runner/logs
  if (req.method === 'GET' && req.url === '/strategy-runner/logs') {
    try {
      sendJson(res, strategyRunnerSe.getLogs());
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // 重启服务接口
  if (req.method === 'POST' && req.url === '/server/restart') {
    sendJson(res, { ok: true, msg: '正在重启...' });
    setTimeout(() => {
      process.exit(0);
    }, 200);
    return;
  }

  // ── 静态资源服务（兜底）───────────────────────────────────────────────
  if (req.method === 'GET' || req.method === 'HEAD') {
    // 映射 /ui/* -> ../../ui/*
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/ui/')) {
      const relPath = decodeURIComponent(pathname.slice('/ui/'.length));
      const absPath = resolve(__dirname, '..', '..', 'ui', relPath);
      // 安全检查：防止目录穿越
      if (!absPath.startsWith(resolve(__dirname, '..', '..', 'ui'))) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (existsSync(absPath) && statSync(absPath).isFile()) {
        const ext = extname(absPath);
        const mime = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          createReadStream(absPath).pipe(res);
        }
        return;
      }
    }
    // 映射根目录 -> ../../ui/btcqdd.html
    if (req.url === '/' || req.url === '/index.html') {
      const absPath = resolve(__dirname, '..', '..', 'ui', 'btcqdd.html');
      if (existsSync(absPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          createReadStream(absPath).pipe(res);
        }
        return;
      }
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(PORT, () => {
  logger.info(EVENTS.SERVER_START, { module: 'server', msg: `listening on http://localhost:${PORT}`, strategy: STRATEGY_ID });
});

// ── WebSocket /events/stream ────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/events/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  logger.info('ws_connect_ok', { module: 'server', path: '/events/stream' });

  const handler = (event) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)); }
      catch (e) { logger.error('ws_send_fail', { module: 'server', err: e.message }); }
    }
  };

  subscribe(handler);

  // 连接确认帧
  ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));

  ws.on('close', () => {
    unsubscribe(handler);
    logger.info('ws_disconnect', { module: 'server', path: '/events/stream' });
  });

  ws.on('error', (e) => {
    logger.error('ws_error', { module: 'server', path: '/events/stream', err: e.message });
    unsubscribe(handler);
  });
});
