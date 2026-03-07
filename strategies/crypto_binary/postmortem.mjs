// postmortem.mjs — 窗口复盘（按 strategy_id 隔离）
// 表名：cb_postmortem（cb = crypto binary）

import '../../OppRadar/proxy_agent.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 复用 OppRadar 的 SQLite 数据库连接
import { getDb } from '../../shared/data/db.mjs';

const BINANCE_BASE = 'https://api.binance.com';

/**
 * 初始化 cb_postmortem 表（若不存在则创建）
 */
export async function initPostmortem() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cb_postmortem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      direction TEXT,
      signal_edge_net REAL,
      p_theory REAL,
      ask_at_signal REAL,
      fee_est REAL,
      K_strike REAL,
      K_binance REAL,
      basis REAL,
      S_at_signal REAL,
      S_at_settlement REAL,
      settled_outcome TEXT,
      paper_fill_price REAL,
      paper_pnl REAL,
      sigma REAL,
      created_at TEXT NOT NULL
    )
  `);
}

/**
 * 获取窗口结算时的 Binance 价格（作为结算价参考）
 */
async function getSettlementPrice(symbol) {
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.warn(`[Postmortem] getSettlementPrice failed: ${e.message}`);
    return null;
  }
}

/**
 * 记录一个窗口的 postmortem
 * @param {object} params
 */
export async function recordPostmortem(params) {
  const {
    strategy_id,
    event_id,
    window_start,
    window_end,
    direction,        // 'UP' | 'DOWN' | null（无信号窗口）
    signal_edge_net,
    p_theory,
    ask_at_signal,
    fee_est,
    K_strike,         // Polymarket strike_price
    K_binance,        // Binance kline open（备用）
    S_at_signal,      // 信号发出时的现货价
    sigma,
    paper_fill_price, // PaperExecutor 成交价
    paper_pnl,        // 本窗口模拟 PnL
    symbol,           // Binance symbol，用于获取结算价
  } = params;

  // 获取结算时刻的 Binance 价格
  const S_at_settlement = await getSettlementPrice(symbol);

  // 推断结算结果（S_at_settlement vs K_strike）
  let settled_outcome = null;
  if (S_at_settlement !== null && K_strike !== null) {
    settled_outcome = S_at_settlement >= K_strike ? 'UP' : 'DOWN';
  }

  const basis = (K_strike !== null && K_binance !== null)
    ? K_strike - K_binance
    : null;

  const db = await getDb();
  await db.run(`
    INSERT INTO cb_postmortem (
      strategy_id, event_id, window_start, window_end,
      direction, signal_edge_net, p_theory, ask_at_signal, fee_est,
      K_strike, K_binance, basis, S_at_signal, S_at_settlement,
      settled_outcome, paper_fill_price, paper_pnl, sigma, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    strategy_id, event_id,
    window_start instanceof Date ? window_start.toISOString() : window_start,
    window_end instanceof Date ? window_end.toISOString() : window_end,
    direction ?? null,
    signal_edge_net ?? null,
    p_theory ?? null,
    ask_at_signal ?? null,
    fee_est ?? null,
    K_strike ?? null,
    K_binance ?? null,
    basis,
    S_at_signal ?? null,
    S_at_settlement,
    settled_outcome,
    paper_fill_price ?? null,
    paper_pnl ?? null,
    sigma ?? null,
    new Date().toISOString(),
  ]);

  console.log(`[Postmortem] Recorded: ${strategy_id} ${event_id} outcome=${settled_outcome} pnl=${paper_pnl ?? 'N/A'}`);
}

/**
 * 查询最近 N 条 postmortem 记录
 */
export async function queryPostmortem(strategy_id, limit = 20) {
  const db = await getDb();
  return db.all(`
    SELECT * FROM cb_postmortem
    WHERE strategy_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [strategy_id, limit]);
}
