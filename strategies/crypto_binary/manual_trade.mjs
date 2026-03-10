// manual_trade.mjs — 手动交易模块
// 职责：DB 迁移（trading_orders 表）、手动下单、手动交易统计

import { logger } from './logger.mjs';

const MODULE = 'manual_trade';

/**
 * 初始化：创建 trading_orders 表（如不存在），并确保 source 列存在（幂等）
 * @param {{ run, all, get, exec }} db - btcqdd db 实例（来自 db.mjs）
 */
export async function initManualTrade(db) {
  // 创建 trading_orders 表（幂等）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS trading_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT,
      side TEXT,
      price REAL,
      size REAL,
      token_id TEXT,
      source TEXT DEFAULT 'strategy',
      status TEXT DEFAULT 'pending',
      order_id TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // 幂等添加 source 列（表可能在其他路径创建但无 source 列）
  try {
    await db.run("ALTER TABLE trading_orders ADD COLUMN source TEXT DEFAULT 'strategy'");
    logger.info('db_migrate', { module: MODULE, msg: 'source column added' });
  } catch (e) {
    logger.debug('db_migrate', { module: MODULE, msg: 'source column already exists, skip' });
  }
}

/**
 * 手动下单
 * @param {{ market_id, side, price, size, token_id }} params
 * @param {{ db }} deps
 * @returns {{ order_id, status, source, market_id, side, price, size }}
 */
export async function submitManualOrder(params, deps) {
  const required = ['market_id', 'side', 'price', 'size'];
  for (const f of required) {
    if (params[f] == null) throw new Error(`missing required field: ${f}`);
  }

  const { market_id, side, price, size, token_id = null } = params;
  const { db } = deps;

  const now = Date.now();
  const order_id = `manual_${now}_${Math.random().toString(36).slice(2, 8)}`;

  await db.run(
    `INSERT INTO trading_orders (market_id, side, price, size, token_id, source, status, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', 'submitted', ?, ?)`,
    [market_id, side, price, size, token_id, order_id, now]
  );

  logger.info('manual_order_submit', { module: MODULE, order_id, market_id, side, price, size });

  return { order_id, status: 'submitted', source: 'manual', market_id, side, price, size };
}

/**
 * 手动交易统计（直接查 trading_orders WHERE source='manual'）
 * @param {{ run, all, get, exec }} db - async db 接口（来自 db.mjs 或测试中的同等封装）
 * @returns {Promise<{ total_trades, wins, losses, total_pnl, win_rate }>}
 */
export async function getManualStats(db) {
  const row = await db.get(
    `SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN status = 'filled' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status != 'filled' THEN 1 ELSE 0 END) as losses,
      0 as total_pnl
    FROM trading_orders
    WHERE source = 'manual'`
  );
  const r = row || { total_trades: 0, wins: 0, losses: 0, total_pnl: 0 };
  const win_rate = r.total_trades > 0 ? (r.wins || 0) / r.total_trades : 0;
  return {
    total_trades: r.total_trades || 0,
    wins: r.wins || 0,
    losses: r.losses || 0,
    total_pnl: r.total_pnl || 0,
    win_rate
  };
}
