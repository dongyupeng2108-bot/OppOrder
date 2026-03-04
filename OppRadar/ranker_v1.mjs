/**
 * ranker_v1.mjs
 * Pure RankerV1 module — no I/O, no side effects.
 *
 * Composes EstimatorV1 + VetoV1 + RiskV1 + FilterV1 outputs
 * into a ranked list of opportunities.
 *
 * Scoring: score = dev_abs − risk.penalty
 *   - Higher score = bigger mispricing with lower risk
 *   - Negative scores are possible (high risk, low deviation)
 *
 * Pipeline per candidate:
 *   1. If filter.skip === true → move to skipped list
 *   2. Compute score = dev_abs − risk.penalty
 *   3. Sort remaining by score descending
 *   4. Attach rank (1-based) and rank_reason
 *
 * Exports:
 *   rankOpportunities(candidates) → RankerOutputV1
 *
 * Candidate shape:
 *   { market, estimator, veto, risk, filter }
 *
 * RankerOutputV1:
 *   { top_n, skipped, total, ranked_count, skipped_count }
 */

export const RANKER_VERSION = 'v1';

/**
 * Rank a list of pre-analyzed candidates.
 *
 * @param {object[]} candidates — each: { market, estimator, veto, risk, filter }
 * @returns {object} RankerOutputV1
 */
export function rankOpportunities(candidates) {
  if (!Array.isArray(candidates)) candidates = [];

  const ranked = [];
  const skipped = [];

  for (const c of candidates) {
    const market = c.market || {};
    const est = c.estimator || {};
    const veto = c.veto || {};
    const risk = c.risk || {};
    const filter = c.filter || {};

    const oppId = market.id || market.opp_id || '';
    const question = market.question || market.title || '';

    // Skip if filter says so
    if (filter.skip === true) {
      skipped.push({
        opp_id: oppId,
        question,
        filter_label: filter.label || 'BLOCKED',
        skip_reason: filter.why_1_liner || 'Skipped by filter',
      });
      continue;
    }

    // Compute score
    const devAbs = typeof est.dev_abs === 'number' ? est.dev_abs : 0;
    const penalty = typeof risk.penalty === 'number' ? risk.penalty : 0;
    const score = parseFloat((devAbs - penalty).toFixed(4));

    // Build rank_reason
    const reason = buildRankReason(score, devAbs, penalty, filter.label, risk.risk_level);

    ranked.push({
      opp_id: oppId,
      question,
      score,
      rank: 0, // filled after sort
      rank_reason: reason,
      estimator: {
        dev_abs: est.dev_abs,
        range_width: est.range_width,
        p_mid: est.p_mid,
        confidence: est.confidence,
        trust_level: est.estimator_trust_level,
      },
      veto: {
        veto_light: veto.veto_light,
        veto_codes: veto.veto_codes,
      },
      risk: {
        risk_level: risk.risk_level,
        penalty: risk.penalty,
        reason: risk.reason,
      },
      filter: {
        label: filter.label,
        skip: filter.skip,
        why_1_liner: filter.why_1_liner,
      },
    });
  }

  // Sort by score descending, stable (ties broken by opp_id for determinism)
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.opp_id < b.opp_id ? -1 : a.opp_id > b.opp_id ? 1 : 0;
  });

  // Assign 1-based rank
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].rank = i + 1;
  }

  return {
    top_n: ranked,
    skipped,
    total: candidates.length,
    ranked_count: ranked.length,
    skipped_count: skipped.length,
  };
}

// ── Helper ──────────────────────────────────────────────────────────────────

function buildRankReason(score, devAbs, penalty, filterLabel, riskLevel) {
  const parts = [];
  parts.push(`score=${score}`);
  parts.push(`dev=${devAbs}`);
  if (penalty > 0) parts.push(`penalty=${penalty}(${riskLevel})`);
  if (filterLabel && filterLabel !== 'UNKNOWN') parts.push(`filter=${filterLabel}`);
  return parts.join(' | ');
}
