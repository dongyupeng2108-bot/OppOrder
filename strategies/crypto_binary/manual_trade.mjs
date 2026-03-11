// manual_trade.mjs — 手动交易模块
// 职责：DB 迁移（trading_orders 表）、手动下单、手动交易统计

import { logger } from './logger.mjs';

const MODULE = 'manual_trade';

/**
 * 初始化：创建 trading_orders 表（如不存在），并确保所需列存在（幂等）
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

  // 幂等添加各列（字段已存在时捕获错误，正常 skip）
  const migrations = [
    "ALTER TABLE trading_orders ADD COLUMN source TEXT DEFAULT 'strategy'",
    "ALTER TABLE trading_orders ADD COLUMN fill_price REAL",
    "ALTER TABLE trading_orders ADD COLUMN pnl REAL DEFAULT 0",
    "ALTER TABLE trading_orders ADD COLUMN updated_at INTEGER",
  ];
  for (const sql of migrations) {
    try {
      await db.run(sql);
      logger.info('db_migrate', { module: MODULE, msg: sql });
    } catch (_) {
      logger.debug('db_migrate', { module: MODULE, msg: 'column already exists, skip' });
    }
  }
}

/**
 * Paper 模式 fill 模拟（异步，不阻塞主流程）
 * @param {number} dbRowId - trading_orders 表中的行 id
 * @param {string} side
 * @param {number} amount
 * @param {number} marketPrice
 * @param {{ run }} db
 */
async function simulatePaperFill(dbRowId, side, amount, marketPrice, db) {
  const FILL_DELAY_MS = 500;
  const FILL_DISCOUNT = 0.5; // 保守 fill model：50% 概率成交

  await new Promise(r => setTimeout(r, FILL_DELAY_MS));

  if (Math.random() > FILL_DISCOUNT) {
    // 未成交：更新为 cancelled
    await db.run(
      `UPDATE trading_orders SET status='cancelled', updated_at=? WHERE id=?`,
      [Date.now(), dbRowId]
    );
    return;
  }

  // 成交：写入 filled 状态，pnl 留 0（待 postmortem 窗口结算后更新）
  await db.run(
    `UPDATE trading_orders SET status='filled', fill_price=?, pnl=0, updated_at=? WHERE id=?`,
    [marketPrice, Date.now(), dbRowId]
  );
}

/**
 * 手动下单
 * @param {{ market_id?, side, price?, size?, amount?, token_id? }} params
 * @param {{ db }} deps
 * @returns {{ order_id, status, source, market_id, side, price, size }}
 */
export async function submitManualOrder(params, deps) {
  if (!params.side) throw new Error('missing required field: side');
  const size = params.size ?? params.amount;
  if (size == null) throw new Error('missing required field: size or amount');

  const {
    side,
    market_id = 'manual_paper',
    price = 0,
    token_id = null,
  } = params;

  const { db } = deps;
  const now = Date.now();
  const order_id = `manual_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const result = await db.run(
    `INSERT INTO trading_orders (market_id, side, price, size, token_id, source, status, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', 'submitted', ?, ?)`,
    [market_id, side, price, size, token_id, order_id, now]
  );

  logger.info('manual_order_submit', { module: MODULE, order_id, market_id, side, price, size });

  // 非阻塞：Paper 模式异步 fill 模拟
  const dbRowId = result.lastInsertRowid;
  simulatePaperFill(dbRowId, side, size, price, db).catch(err =>
    logger.error('paper_fill_error', { module: MODULE, msg: err.message })
  );

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
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as losses,
      COALESCE(SUM(CASE WHEN status = 'filled' THEN COALESCE(pnl, 0) ELSE 0 END), 0) as total_pnl
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
