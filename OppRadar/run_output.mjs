/**
 * run_output.mjs
 * M1-T6a: 每次Run的闭环输出生成器
 * 生成 opportunities.json + report.md
 */

import fs from 'fs';
import path from 'path';

/**
 * 为一次run生成闭环输出
 * @param {string} runId
 * @param {object[]} cards - strategyCards（OpportunityCard[]）
 * @param {string} outputDir - 输出目录（data/runs/{runId}/）
 */
export function writeRunOutput(runId, cards, outputDir) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. opportunities.json（机器读）
    const oppsJson = cards.map(card => ({
      opp_id: card.id || card.opp_id,
      title: card.title,
      score: card.score,
      score_v2: card.score_v2,
      run_id: runId,
      created_at: card.created_at,
      strategy_id: card.strategy_id,
      meta: card.meta || {}
    }));
    fs.writeFileSync(
      path.join(outputDir, 'opportunities.json'),
      JSON.stringify(oppsJson, null, 2),
      'utf8'
    );

    // 2. report.md（人读，Top3+Next7）
    const sorted = [...cards].sort((a, b) => (b.score_v2 || 0) - (a.score_v2 || 0));
    const top3 = sorted.slice(0, 3);
    const next7 = sorted.slice(3, 10);

    const formatCard = (card, rank) => {
      const id = card.id || card.opp_id;
      const score_v2 = (card.score_v2 || 0).toFixed(4);
      const strategy = card.strategy_id || 'unknown';
      const state = card.meta?.tradeable_state || 'UNKNOWN';
      return [
        `### #${rank} ${card.title || id}`,
        `- opp_id: ${id}`,
        `- score_v2: ${score_v2}`,
        `- strategy: ${strategy}`,
        `- tradeable_state: ${state}`,
        `- run_id: ${runId}`,
        `- invalidations: n/a`,
        `- risk_flags: []`,
      ].join('\n');
    };

    const reportLines = [
      `# OppRadar Run Report`,
      ``,
      `**run_id**: ${runId}`,
      `**generated_at**: ${new Date().toISOString()}`,
      `**total_cards**: ${cards.length}`,
      ``,
      `## Top 3`,
      ``,
      ...top3.map((c, i) => formatCard(c, i + 1)),
      ``,
      `## Next 7`,
      ``,
      ...next7.map((c, i) => formatCard(c, i + 4)),
    ];

    fs.writeFileSync(
      path.join(outputDir, 'report.md'),
      reportLines.join('\n'),
      'utf8'
    );

    return { ok: true, cards_written: oppsJson.length };
  } catch (err) {
    console.error('[run_output] write error:', err.message);
    return { ok: false, error: err.message };
  }
}
