/**
 * filter_v1.mjs
 * Pure FilterV1 classifier — no I/O, no side effects.
 *
 * Single-label classification, first-match-wins (priority high→low):
 *   1. veto_light=RED           → BLOCKED  skip=true
 *   2. range_width>0.4 & no claims → THIN  skip=false
 *   3. veto_light=YELLOW & RULE code → RULE skip=false
 *   4. risk_level=HIGH          → RULE     skip=false
 *   5. expiry < 3 days          → SLOW     skip=false
 *   6. dev_abs < 0.05           → SLOW     skip=false
 *   7. else                     → UNKNOWN  skip=false
 *
 * Exports:
 *   classifyOpportunity(estimatorOutput, vetoResult, riskResult, marketMeta) → FilterResultV1
 *
 * FilterResultV1:
 *   { label, skip, why_1_liner, dev_abs, triggered_rule }
 */

export const FILTER_VERSION = 'v1';

/**
 * Classify an opportunity into a single label.
 * First-match-wins priority.
 *
 * @param {object} estimatorOutput — from EstimatorV1
 * @param {object} vetoResult      — from VetoV1 (veto_light, veto_codes)
 * @param {object} riskResult      — from RiskV1 (risk_level)
 * @param {object} marketMeta      — market data (end_date, as_of_utc)
 * @returns {object} FilterResultV1
 */
export function classifyOpportunity(estimatorOutput, vetoResult, riskResult, marketMeta = {}) {
  const est = estimatorOutput || {};
  const veto = vetoResult || {};
  const risk = riskResult || {};
  const meta = marketMeta || {};

  const devAbs = typeof est.dev_abs === 'number' ? est.dev_abs : null;
  const rangeWidth = typeof est.range_width === 'number' ? est.range_width : null;
  const claims = Array.isArray(est.claims) ? est.claims : [];
  const vetoCodes = Array.isArray(veto.veto_codes) ? veto.veto_codes : [];

  // ── Rule 1: veto_light = RED → BLOCKED ────────────────────────────────
  if (veto.veto_light === 'RED') {
    return out('BLOCKED', true, 'Blocked by veto engine (RED)', devAbs, 1);
  }

  // ── Rule 2: range_width > 0.4 AND claims empty → THIN ─────────────────
  if (rangeWidth !== null && rangeWidth > 0.4 && claims.length === 0) {
    return out('THIN', false, `Wide range (${rangeWidth}) with no supporting claims`, devAbs, 2);
  }

  // ── Rule 3: veto_light = YELLOW AND veto_codes contain RULE* → RULE ───
  if (veto.veto_light === 'YELLOW') {
    const hasRuleCode = vetoCodes.some(c => typeof c === 'string' && c.includes('RULE'));
    if (hasRuleCode) {
      return out('RULE', false, 'Veto warning with rule-related code', devAbs, 3);
    }
  }

  // ── Rule 4: risk_level = HIGH → RULE ──────────────────────────────────
  if (risk.risk_level === 'HIGH') {
    return out('RULE', false, `High risk: ${risk.reason || 'unknown'}`, devAbs, 4);
  }

  // ── Rule 5: expiry < 3 days → SLOW ────────────────────────────────────
  const endTime = meta.end_time_utc || meta.end_date || null;
  const asOf = meta.as_of_utc ? new Date(meta.as_of_utc) : new Date();
  if (endTime) {
    const end = new Date(endTime);
    const daysLeft = (end.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft >= 0 && daysLeft < 3) {
      return out('SLOW', false, `Expiry in ${daysLeft.toFixed(1)} days`, devAbs, 5);
    }
  }

  // ── Rule 6: dev_abs < 0.05 → SLOW ────────────────────────────────────
  if (devAbs !== null && devAbs < 0.05) {
    return out('SLOW', false, `Deviation too small (${devAbs})`, devAbs, 6);
  }

  // ── Rule 7: fallthrough → UNKNOWN ─────────────────────────────────────
  return out('UNKNOWN', false, 'No specific classification matched', devAbs, 7);
}

// ── Helper ──────────────────────────────────────────────────────────────────

function out(label, skip, why, devAbs, ruleNum) {
  return {
    label,
    skip,
    why_1_liner: why.slice(0, 80),
    dev_abs: devAbs,
    triggered_rule: ruleNum,
  };
}
