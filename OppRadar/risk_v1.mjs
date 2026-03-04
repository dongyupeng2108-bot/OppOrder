/**
 * risk_v1.mjs
 * Pure RiskV1 assessment module — no I/O, no side effects.
 *
 * Grading logic: first-match-wins (highest priority first).
 *
 * Priority (HIGH → MED → LOW):
 *   1. risk_triggers contains BLACK_SWAN|REGIME_CHANGE → HIGH  CATASTROPHIC_TRIGGER
 *   2. range_width > 0.5                               → HIGH  HIGH_UNCERTAINTY
 *   3. estimator_trust_level = RED                      → HIGH  UNTRUSTWORTHY_ESTIMATE
 *   4. risk_triggers non-empty (normal)                 → MED   KNOWN_RISK_FACTOR
 *   5. confidence = Low                                 → MED   LOW_CONFIDENCE
 *   6. end_time < 7 days from as_of                     → MED   EXPIRY_SOON
 *   7. else                                             → LOW   NO_SIGNIFICANT_RISK
 *
 * Exports:
 *   assessRisk(estimatorOutput, marketMeta) → RiskResultV1
 *
 * RiskResultV1:
 *   { risk_level, reason, penalty, triggered_rule, details }
 */

export const RISK_VERSION = 'v1';

// ── Penalty table ───────────────────────────────────────────────────────────

const PENALTY = { HIGH: 0.3, MED: 0.15, LOW: 0 };

// ── Catastrophic trigger keywords ───────────────────────────────────────────

const CATASTROPHIC_TRIGGERS = ['BLACK_SWAN', 'REGIME_CHANGE'];

// ── Main: assessRisk ────────────────────────────────────────────────────────

/**
 * Assess risk level from estimator output + market metadata.
 * First-match-wins: highest-priority rule that fires determines the result.
 *
 * @param {object} estimatorOutput — from EstimatorV1 (needs: risk_triggers,
 *        range_width, estimator_trust_level, confidence)
 * @param {object} marketMeta — market metadata (needs: end_date or end_time_utc,
 *        as_of_utc optional — defaults to now)
 * @returns {object} RiskResultV1
 */
export function assessRisk(estimatorOutput, marketMeta = {}) {
  const est = estimatorOutput || {};
  const meta = marketMeta || {};
  const triggers = Array.isArray(est.risk_triggers) ? est.risk_triggers : [];

  // ── Rule 1: Catastrophic triggers ─────────────────────────────────────
  const upperTriggers = triggers.map(t => typeof t === 'string' ? t.toUpperCase() : '');
  const hasCatastrophic = upperTriggers.some(t => CATASTROPHIC_TRIGGERS.includes(t));
  if (hasCatastrophic) {
    return result('HIGH', 'CATASTROPHIC_TRIGGER', 1, { matched_triggers: triggers.filter(t => CATASTROPHIC_TRIGGERS.includes(t.toUpperCase())) });
  }

  // ── Rule 2: range_width > 0.5 ─────────────────────────────────────────
  if (typeof est.range_width === 'number' && est.range_width > 0.5) {
    return result('HIGH', 'HIGH_UNCERTAINTY', 2, { range_width: est.range_width });
  }

  // ── Rule 3: estimator_trust_level = RED ───────────────────────────────
  if (est.estimator_trust_level === 'RED') {
    return result('HIGH', 'UNTRUSTWORTHY_ESTIMATE', 3, { trust_level: est.estimator_trust_level, trust_score: est.estimator_trust_score });
  }

  // ── Rule 4: risk_triggers non-empty (normal triggers) ─────────────────
  if (triggers.length > 0) {
    return result('MED', 'KNOWN_RISK_FACTOR', 4, { triggers });
  }

  // ── Rule 5: confidence = Low ──────────────────────────────────────────
  if (est.confidence === 'Low') {
    return result('MED', 'LOW_CONFIDENCE', 5, { confidence: est.confidence });
  }

  // ── Rule 6: expiry within 7 days ──────────────────────────────────────
  const endTime = meta.end_time_utc || meta.end_date || null;
  const asOf = meta.as_of_utc ? new Date(meta.as_of_utc) : new Date();
  if (endTime) {
    const end = new Date(endTime);
    const daysLeft = (end.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft >= 0 && daysLeft < 7) {
      return result('MED', 'EXPIRY_SOON', 6, { days_left: parseFloat(daysLeft.toFixed(2)) });
    }
  }

  // ── Rule 7: No significant risk ──────────────────────────────────────
  return result('LOW', 'NO_SIGNIFICANT_RISK', 7, {});
}

// ── Helper ──────────────────────────────────────────────────────────────────

function result(level, reason, ruleNum, details) {
  return {
    risk_level: level,
    reason,
    penalty: PENALTY[level],
    triggered_rule: ruleNum,
    details,
  };
}
