/**
 * scan_filter.mjs
 * M1-T4: Scan硬过滤器
 * 对score_baseline之后的opp列表做硬过滤，不符合条件的opp不进入scan结果
 */

/**
 * 默认过滤阈值
 */
export const SCAN_FILTER_DEFAULTS = {
  min_score: 10,          // score < 10 直接丢弃
  require_tradeable: false // 是否只保留TRADEABLE（默认不强制）
};

/**
 * 硬过滤器主函数
 * @param {object[]} opps - score_baseline之后的opp数组
 * @param {object} opts - 过滤选项
 * @param {number} [opts.min_score] - 最低score阈值，低于此值丢弃
 * @param {boolean} [opts.require_tradeable] - 是否只保留TRADEABLE
 * @returns {{ passed: object[], filtered: object[], filter_log: object }}
 */
export function applyHardFilter(opps, opts = {}) {
  const min_score = opts.min_score ?? SCAN_FILTER_DEFAULTS.min_score;
  const require_tradeable = opts.require_tradeable ?? SCAN_FILTER_DEFAULTS.require_tradeable;

  const passed = [];
  const filtered = [];

  for (const opp of opps) {
    const reasons = [];

    if (typeof opp.score === 'number' && opp.score < min_score) {
      reasons.push(`score ${opp.score} < min_score ${min_score}`);
    }

    if (require_tradeable && opp.tradeable_state !== 'TRADEABLE') {
      reasons.push(`tradeable_state=${opp.tradeable_state} not TRADEABLE`);
    }

    if (reasons.length > 0) {
      filtered.push({ opp_id: opp.opp_id, reasons });
    } else {
      passed.push(opp);
    }
  }

  const filter_log = {
    total_input: opps.length,
    passed: passed.length,
    filtered_count: filtered.length,
    min_score,
    require_tradeable,
    filtered_ids: filtered.map(f => f.opp_id)
  };

  return { passed, filtered, filter_log };
}
