// BTCQDD 独立服务入口
// 端口 53123（默认），支持 --strategy=<id> 和 --port=<n> 参数
// 提供：GET / 健康检查，POST /config/reload 热更新

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRunner } from './strategy_runner.mjs';
import { initPostmortem } from './postmortem.mjs';
import { logger, EVENTS } from './logger.mjs';
import { getDb } from './db.mjs';
import { initManualTrade, submitManualOrder, getManualStats } from './manual_trade.mjs';

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
(async () => {
  db = await getDb();
  await initPostmortem();
  await initManualTrade(db);
  console.log('[BTCQDD] DB migration completed (initPostmortem + initManualTrade)');
  await runner.start();
})().catch(err => {
  logger.error(EVENTS.ERROR_UNHANDLED_PATH, { module: 'server', err: err.message, msg: 'runner failed to start' });
});

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  // CORS headers for local UI (file:// → localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

      console.log(`[BTCQDD] Config reloaded. Diff:`, JSON.stringify(diff));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'reloaded',
        strategy_id: config.strategy_id,
        diff,
        ts: new Date().toISOString()
      }));
    } catch (err) {
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

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(PORT, () => {
  logger.info(EVENTS.SERVER_START, { module: 'server', msg: `listening on http://localhost:${PORT}`, strategy: STRATEGY_ID });
});
