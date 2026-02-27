/**
 * strategies/mock_strategy.mjs
 * M1-T5: Mock Strategy插件实现
 *
 * 职责：将candidates转换为OpportunityCard[]
 * mock模式下确定性输出（同input_fingerprint必出同结果）
 */

import crypto from 'crypto';

export const mockStrategy = {
  id: 'mock_strategy',
  version: '0.1.0',

  /**
   * @param {object} snapshot
   * @param {object[]} candidates - 已通过硬过滤的opp候选
   * @param {object} ctx - StrategyContext
   * @returns {object[]} OpportunityCard[]
   */
  run(snapshot, candidates, ctx) {
    const cards = [];

    for (const candidate of candidates) {
      // 确定性score_v2（mock模式下同id必出同结果）
      const hash = crypto.createHash('sha256')
        .update(candidate.opp_id + ctx.input_fingerprint)
        .digest('hex');
      const score_v2 = parseFloat(
        (parseInt(hash.substring(0, 8), 16) / 0xFFFFFFFF).toFixed(4)
      );

      // 补全OpportunityCard required字段
      const card = {
        id: candidate.opp_id,
        title: `Opp ${candidate.opp_id} via ${ctx.strategy_id}`,
        score: candidate.score,
        run_id: ctx.run_id,
        created_at: candidate.created_at,
        score_v2,
        strategy_id: ctx.strategy_id,
        meta: {
          provider_mode: ctx.provider_mode,
          input_fingerprint: ctx.input_fingerprint,
          tradeable_state: candidate.tradeable_state
        }
      };

      cards.push(card);
    }

    // mock模式下按score_v2确定性排序
    cards.sort((a, b) => b.score_v2 - a.score_v2);

    return cards;
  }
};
