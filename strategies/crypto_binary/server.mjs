// BTCQDD 独立服务入口
// 端口 53123（默认），支持 --strategy=<id> 和 --port=<n> 参数
// 提供：GET / 健康检查，POST /config/reload 热更新

import { createServer } from 'http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createRunner } from './strategy_runner.mjs';
import { initPostmortem } from './postmortem.mjs';
import { logger, EVENTS } from './logger.mjs';
import { getDb } from './db.mjs';
import { initManualTrade, submitManualOrder, getManualStats } from './manual_trade.mjs';
import { publish, subscribe, unsubscribe, EVENT_TYPES } from './event_bus.mjs';
import { getAttribution, getLossModes, getSensitivity, getDistribution, getCompare } from './postmortem_api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 解析命令行参数
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);
const STRATEGY_ID = args.strategy || 'btc_15m';
const PORT = parseInt(args.port || '53123', 10);

// 加载策略配置
function loadConfig(strategyId) {
  const configPath = resolve(__dirname, 'instances', `${strategyId}.json`);
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

let config = loadConfig(STRATEGY_ID);
logger.info(EVENTS.SERVER_START, {
  module: 'server',
  log_level: process.env.LOG_LEVEL || 'info',
  port: PORT,
  strategy: STRATEGY_ID,
  display_name: config.display_name,
});

// 启动策略运行器（先确保 DB 迁移完成）
let runner = createRunner(config);
let db = null;

// Runner 注册表：key=实例名，value={ running, last_error, last_heartbeat }
const globalRunnerRegistry = new Map();
(async () => {
  db = await getDb();
  await initPostmortem();
  await initManualTrade(db);
  console.log('[BTCQDD] DB migration completed (initPostmortem + initManualTrade)');
  await runner.start();

  // 定时轮询检测 regime/window 状态变化 → publish 事件（替代方案，2s 延迟）
  // 所有内部事件发射点均在 scope 外模块，无法直接注入 publish，故采用轮询
  let _lastRegimeScore = null;
  let _lastWindowId = null;
  setInterval(() => {
    try {
      const regimeState = runner.getRegimeState();
      if (regimeState) {
        const score = regimeState.regime_score ?? null;
        if (_lastRegimeScore !== null && score !== null && Math.abs(score - _lastRegimeScore) > 0.05) {
          publish(EVENT_TYPES.REGIME_CHANGED, { regime_score: score, prev: _lastRegimeScore });
        }
        _lastRegimeScore = score;

        const windowId = regimeState.current_window ?? null;
        if (_lastWindowId !== null && windowId !== null && windowId !== _lastWindowId) {
          publish(EVENT_TYPES.WINDOW_SWITCH, { window_id: windowId, prev: _lastWindowId });
        }
        _lastWindowId = windowId;
      }
    } catch (_) { /* runner not yet ready */ }
  }, 2000);
})().catch(err => {
  logger.error(EVENTS.ERROR_UNHANDLED_PATH, { module: 'server', err: err.message, msg: 'runner failed to start' });
});

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
      strategy_id: config.strategy_id,
      display_name: config.display_name,
      port: PORT,
      ts: new Date().toISOString()
    }));
    return;
  }

  // POST /config/reload — 热更新
  if (req.method === 'POST' && req.url === '/config/reload') {
    globalRunnerRegistry.set(STRATEGY_ID, { running: false, last_error: null, last_heartbeat: null });
    try {
      const oldConfig = JSON.parse(JSON.stringify(config));
      config = loadConfig(STRATEGY_ID);

      // 计算 diff
      const diff = {};
      for (const section of ['signal', 'risk', 'model', 'strategy', 'cancel']) {
        const oldSec = oldConfig[section] || {};
        const newSec = config[section] || {};
        const sectionDiff = {};
        for (const key of new Set([...Object.keys(oldSec), ...Object.keys(newSec)])) {
          if (JSON.stringify(oldSec[key]) !== JSON.stringify(newSec[key])) {
            sectionDiff[key] = { old: oldSec[key], new: newSec[key] };
          }
        }
        if (Object.keys(sectionDiff).length > 0) diff[section] = sectionDiff;
      }

      // 通知 runner 使用新配置
      if (typeof runner.reload === 'function') {
        runner.reload(config);
      }

      globalRunnerRegistry.set(STRATEGY_ID, { running: true, last_error: null, last_heartbeat: Date.now() });
      console.log(`[BTCQDD] Config reloaded. Diff:`, JSON.stringify(diff));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'reloaded',
        strategy_id: config.strategy_id,
        diff,
        ts: new Date().toISOString()
      }));
    } catch (err) {
      globalRunnerRegistry.set(STRATEGY_ID, { running: false, last_error: err.message, last_heartbeat: null });
      console.error(`[BTCQDD] Config reload failed:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  // ── UI 专用端点（B1 控制面板）──────────────────────────

  // GET /ui/regime — 当前市场状态评分
  if (req.method === 'GET' && req.url === '/ui/regime') {
    try {
      const state = runner.getRegimeState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: state }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/instances — 所有策略实例当前状态
  if (req.method === 'GET' && req.url === '/ui/instances') {
    try {
      const stats = runner.getInstanceStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: stats }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/cancel-stats — 撤单引擎统计
  if (req.method === 'GET' && req.url === '/ui/cancel-stats') {
    try {
      const stats = runner.getCancelStats();
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
      const orders = runner.getActiveOrders();
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
      const snap = runner.getOrderbookSnapshot();
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

  // ── 复盘分析端点（UI-M4）──────────────────────────────────

  // GET /postmortem/attribution
  if (req.method === 'GET' && req.url === '/postmortem/attribution') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getAttribution(db));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/loss-modes
  if (req.method === 'GET' && req.url === '/postmortem/loss-modes') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getLossModes(db));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/sensitivity
  if (req.method === 'GET' && req.url === '/postmortem/sensitivity') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getSensitivity(db));
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

        // 合并参数，strategy_id 必须等于实例名
        const newConfig = { ...template, ...overrides, strategy_id: name };

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

  // ─── POST /strategies/stop ─────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/strategies/stop') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name 必填' }, 400); return; }

        const filePath = resolve(__dirname, 'instances', `${name}.json`);
        if (!existsSync(filePath)) {
          sendJson(res, { ok: false, error: `实例 ${name} 不存在` }, 404);
          return;
        }

        const cfg = JSON.parse(readFileSync(filePath, 'utf8'));
        cfg.enabled = false;
        writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf8');

        fetch(`http://localhost:${PORT}/config/reload`, { method: 'POST' }).catch(() => {});

        sendJson(res, { ok: true, name, enabled: false });
      } catch (e) {
        sendJson(res, { ok: false, error: e.message }, 500);
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
          res.end(JSON.stringify({ ok: true, written: instancePath }));
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
    try {
      const instancesDir = resolve(__dirname, 'instances');
      const files = readdirSync(instancesDir).filter(f => f.endsWith('.json'));

      const instances = files.map(f => {
        const name = f.replace('.json', '');
        let desired_state = true;
        try {
          const cfg = JSON.parse(readFileSync(resolve(instancesDir, f), 'utf8'));
          desired_state = cfg.enabled !== false; // 默认 true，显式 false 才关
        } catch (_) {}

        // runtime_state 从全局 runner 注册表读取
        const runnerInfo = globalRunnerRegistry.get(name) || {};

        return {
          name,
          desired_state,
          runtime_state: runnerInfo.running === true,
          last_error: runnerInfo.last_error || null,
          last_heartbeat: runnerInfo.last_heartbeat || null,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ instances }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
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
