/**
 * postmortem_stats.mjs
 * M6-A3 (260302_016): Aggregation queries for postmortem statistics.
 *
 * All queries default to WHERE is_latest=1.
 * group_by enum values match postmortem table field names exactly (HR-4).
 * hit_rate denominator = COUNT(direction_correct) not COUNT(*) (HR-2).
 * count/sum empty = 0, rate/avg empty = null (HR-7).
 *
 * Exports:
 *   getStats({ group_by, time_range, strategy_id })
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let sqlite3;
try { sqlite3 = require('sqlite3'); } catch (_) {}

const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!sqlite3) return null;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new sqlite3.Database(DB_PATH);
  return _db;
}

function allAsync(sql, params = []) {
  const db = getDb();
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Valid group_by values — must match postmortem table field names exactly (HR-4)
const VALID_GROUP_BY = [
  'strategy_id',
  'time_bucket',
  'veto_status',
  'risk_level',
  'confidence',
  'active_snapshot_type',
  'is_topn',
  'filter_type',
];

/**
 * Build the SELECT expression for a group_by dimension.
 * time_bucket is special: derived from outcome_ts via strftime.
 * All others are direct column references.
 */
function groupByExpr(groupBy) {
  if (groupBy === 'time_bucket') {
    // ISO week: YYYY-Www
    return `strftime('%Y-W%W', outcome_ts)`;
  }
  return groupBy;
}

/**
 * Compute aggregate metrics from raw rows (for a single group).
 * Follows HR-2, HR-7, HR-8 strictly.
 */
function computeMetrics(row) {
  const count_total = row.count_total || 0;
  const count_predicted = row.count_predicted || 0;
  const sum_direction_correct = row.sum_direction_correct || 0;
  const sum_pnl_simulated = row.sum_pnl || 0;

  return {
    count_total,
    count_predicted,
    pred_coverage: count_total > 0 ? round4(count_predicted / count_total) : null,
    avg_edge_net: row.avg_edge_net != null ? round4(row.avg_edge_net) : null,
    hit_rate: count_predicted > 0 ? round4(sum_direction_correct / count_predicted) : null,
    sum_pnl_simulated: round4(sum_pnl_simulated),
    avg_abs_deviation: row.avg_abs_dev != null ? round4(row.avg_abs_dev) : null,
  };
}

function round4(v) {
  if (v == null) return null;
  return Math.round(v * 10000) / 10000;
}

/**
 * Get postmortem stats with grouping and optional time_range filter.
 *
 * @param {{ group_by?: string, time_range?: string, strategy_id?: string }} params
 *   group_by: one of VALID_GROUP_BY
 *   time_range: "start_date,end_date" (ISO date strings)
 *   strategy_id: optional filter
 * @returns {Promise<{ groups: object[], total: object, meta: object }>}
 */
export async function getStats({ group_by, time_range, strategy_id } = {}) {
  // Validate group_by
  if (group_by && !VALID_GROUP_BY.includes(group_by)) {
    throw new Error(`Invalid group_by: ${group_by}. Must be one of: ${VALID_GROUP_BY.join(', ')}`);
  }

  // Build WHERE clause: always is_latest=1
  const conditions = ['is_latest = 1'];
  const params = [];

  if (time_range) {
    const parts = time_range.split(',').map(s => s.trim());
    if (parts.length === 2) {
      conditions.push('outcome_ts >= ?');
      params.push(parts[0]);
      conditions.push('outcome_ts <= ?');
      params.push(parts[1] + 'T23:59:59.999Z');
    }
  }

  if (strategy_id) {
    conditions.push('strategy_id = ?');
    params.push(strategy_id);
  }

  const whereClause = conditions.join(' AND ');

  // Aggregate SQL fragment (shared between grouped and total)
  const aggColumns = `
    COUNT(*) as count_total,
    COUNT(direction_correct) as count_predicted,
    SUM(direction_correct) as sum_direction_correct,
    AVG(CASE WHEN edge_net IS NOT NULL THEN edge_net END) as avg_edge_net,
    SUM(CASE WHEN pnl_simulated IS NOT NULL THEN pnl_simulated ELSE 0 END) as sum_pnl,
    AVG(ABS(p_baseline_mid - actual)) as avg_abs_dev
  `;

  // Total (ungrouped)
  const totalRows = await allAsync(
    `SELECT ${aggColumns} FROM postmortem WHERE ${whereClause}`,
    params
  );
  const totalRow = totalRows[0] || { count_total: 0, count_predicted: 0, sum_direction_correct: 0, avg_edge_net: null, sum_pnl: 0, avg_abs_dev: null };
  const total = computeMetrics(totalRow);

  // Grouped
  let groups = [];
  if (group_by) {
    const expr = groupByExpr(group_by);
    const groupedRows = await allAsync(
      `SELECT ${expr} as grp_key, ${aggColumns} FROM postmortem WHERE ${whereClause} GROUP BY ${expr} ORDER BY ${expr}`,
      params
    );

    groups = groupedRows.map(row => ({
      key: row.grp_key != null ? String(row.grp_key) : 'null',
      ...computeMetrics(row),
    }));
  }

  const meta = {
    group_by: group_by || null,
    time_range: time_range || null,
    strategy_id: strategy_id || null,
    filter: 'is_latest=true',
    generated_at: new Date().toISOString(),
  };

  return { groups, total, meta };
}

/** Expose VALID_GROUP_BY for schema validation */
export { VALID_GROUP_BY };

/**
 * Close the DB connection (for test cleanup).
 */
export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
