// postmortem_api.mjs — 复盘分析聚合查询（只读）
// window_start 为 ISO 字符串（如 '2026-03-08T20:55:00.000Z'）
// db 为 getDb() 返回的 async 封装 { run, all, get, exec }

const MODULE = 'postmortem_api';

/**
 * getAttribution(db) — 利润归因（regime 分桶 + 时段分桶）
 */
export async function getAttribution(db) {
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
    WHERE regime_score IS NOT NULL
    GROUP BY regime_bucket
    ORDER BY regime_bucket
  `);

  // window_start 为 ISO 字符串，直接用 strftime('%H', window_start)
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
    WHERE window_start IS NOT NULL
    GROUP BY hour_bucket
    ORDER BY hour_bucket
  `);

  return { regime_buckets: regimeBuckets, hour_buckets: hourBuckets };
}

/**
 * getLossModes(db) — 失败模式分析
 */
export async function getLossModes(db) {
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
    WHERE pair_cost IS NULL OR pair_cost >= 1.0
    GROUP BY loss_mode
    ORDER BY count DESC
  `);

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
      ) = ?
      ORDER BY id DESC LIMIT 1
    `, [mode.loss_mode]);
    if (ex) examples[mode.loss_mode] = ex;
  }

  return { modes, examples };
}

/**
 * getSensitivity(db) — 参数敏感度（按 config_hash 分组）
 */
export async function getSensitivity(db) {
  return db.all(`
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
    WHERE config_hash IS NOT NULL
    GROUP BY config_hash, strategy_id
    ORDER BY avg_cost ASC
  `);
}

/**
 * getDistribution(db) — 单笔 PnL 分布（bucket 分组）
 */
export async function getDistribution(db) {
  return db.all(`
    SELECT
      CASE
        WHEN pair_cost IS NULL      THEN 'null'
        WHEN pair_cost < 0.90       THEN 'gt_10pct'
        WHEN pair_cost < 0.95       THEN '5_10pct'
        WHEN pair_cost < 1.0        THEN '0_5pct'
        WHEN pair_cost < 1.05       THEN 'neg_0_5pct'
        WHEN pair_cost < 1.10       THEN 'neg_5_10pct'
        ELSE                        'lt_neg_10pct'
      END as bucket,
      COUNT(*) as count
    FROM cb_postmortem
    GROUP BY bucket
    ORDER BY bucket
  `);
}

/**
 * getCompare(db, strategyIds) — 多策略横向对比
 * @param {string[]} strategyIds
 */
export async function getCompare(db, strategyIds) {
  if (!strategyIds || strategyIds.length === 0) {
    return { summary: [], timeseries: [] };
  }

  const placeholders = strategyIds.map(() => '?').join(',');

  const summary = await db.all(`
    SELECT
      strategy_id,
      COUNT(*) as total_windows,
      SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0 THEN 1 ELSE 0 END) as wins,
      AVG(pair_cost) as avg_cost,
      MIN(pair_cost) as best_cost,
      AVG(regime_score) as avg_regime
    FROM cb_postmortem
    WHERE strategy_id IN (${placeholders})
    GROUP BY strategy_id
  `, strategyIds);

  // 累计 PnL 时间序列（window 函数，SQLite 3.25+ 支持）
  let timeseries = [];
  try {
    timeseries = await db.all(`
      SELECT strategy_id, window_start,
        SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0 THEN 1.0 - pair_cost ELSE 0 END)
          OVER (PARTITION BY strategy_id ORDER BY window_start ROWS UNBOUNDED PRECEDING) as cumulative_pnl
      FROM cb_postmortem
      WHERE strategy_id IN (${placeholders})
      ORDER BY strategy_id, window_start
    `, strategyIds);
  } catch (e) {
    timeseries = [];
  }

  return { summary, timeseries };
}
