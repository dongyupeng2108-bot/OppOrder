// BTCQDD 独立服务入口
// 端口 53123（默认），支持 --strategy=<id> 和 --port=<n> 参数
// 提供：GET / 健康检查，POST /config/reload 热更新

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
console.log(`[BTCQDD] Loaded config: ${config.display_name} (strategy_id: ${config.strategy_id})`);

// TODO: B1 实现 — strategy_runner 初始化
// import { createRunner } from './strategy_runner.mjs';
// let runner = createRunner(config);

const server = createServer((req, res) => {
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

      // 计算 diff（只对比 signal / risk / model 可热更新部分）
      const diff = {};
      for (const section of ['signal', 'risk', 'model']) {
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

      // TODO: B1 实现 — 通知 runner 使用新配置重建模块
      // runner.reload(config);

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

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`[BTCQDD] Server running on http://localhost:${PORT} (strategy: ${STRATEGY_ID})`);
});
