/**
 * polymarket_eligible_filter.mjs
 * Applies five hard eligibility filters to a list of normalized Polymarket markets.
 *
 * Five hard filters (ALL must pass to be a candidate):
 *  0. Settled market exclusion — yes_price === 0 or yes_price === 1 (market already resolved)
 *  1. Numeric threshold proposition — title or question matches number + comparison word
 *  2. Has explicit settlement time — event_time exists and is valid ISO8601
 *  3. TTL30d window — event_time - now <= 30 days
 *  4. Valid price — yes_price ∈ (0.05, 0.95)
 *  5. Candidate cap — output ≤ 50 (sorted by |yes_price - 0.5| ascending, take top 50)
 *
 * Exports:
 *   applyEligibleFilter(markets) -> { candidates, scan_stats }
 */

// Regex: number followed by comparison word (or comparison word followed by number)
const NUMERIC_THRESHOLD_RE = /\b(\d[\d.,]*\s*(?:above|below|exceed|reach|over|under|more than|less than|at least|higher|lower|greater)|(?:above|below|exceed|reach|over|under|more than|less than|at least|higher|lower|greater)\s*\d[\d.,]*)\b/i;

const TTL_30D_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
const CANDIDATE_CAP = 50;

/**
 * Check if a string is a valid ISO8601 date that can be parsed by Date.
 */
function isValidIso8601(str) {
  if (!str || typeof str !== 'string') return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

/**
 * Apply all five eligibility filters.
 *
 * @param {object[]} markets - Array of normalized markets from polymarket_provider
 * @returns {{ candidates: object[], scan_stats: object }}
 */
export function applyEligibleFilter(markets) {
  const now = new Date();
  const ttlCutoff = new Date(now.getTime() + TTL_30D_MS);
  const scanTime = now.toISOString();
  const ttlCutoffIso = ttlCutoff.toISOString();

  const fetched_total = markets.length;

  const breakdown = {
    settled_market: 0,
    no_numeric_threshold: 0,
    no_event_time: 0,
    ttl_exceeded: 0,
    price_out_of_range: 0,
  };

  const passed = [];

  for (const market of markets) {
    // Filter 0: Exclude settled markets (yes_price === 0 or === 1)
    const price = market.yes_price;
    if (price === 0 || price === 1) {
      breakdown.settled_market++;
      continue;
    }

    const text = `${market.title || ''} ${market.question || ''}`;

    // Filter 1: Numeric threshold proposition
    if (!NUMERIC_THRESHOLD_RE.test(text)) {
      breakdown.no_numeric_threshold++;
      continue;
    }

    // Filter 2: Has valid ISO8601 settlement time
    if (!isValidIso8601(market.event_time)) {
      breakdown.no_event_time++;
      continue;
    }

    // Filter 3: TTL30d — event_time must be within 30 days from now
    const eventDate = new Date(market.event_time);
    if (eventDate > ttlCutoff) {
      breakdown.ttl_exceeded++;
      continue;
    }

    // Filter 4: yes_price ∈ (0.05, 0.95)
    if (price === null || price === undefined || isNaN(price) || price <= 0.05 || price >= 0.95) {
      breakdown.price_out_of_range++;
      continue;
    }

    passed.push(market);
  }

  // Filter 5: Cap at 50 — sort by proximity to 0.5 (most uncertain = most interesting)
  passed.sort((a, b) => Math.abs(a.yes_price - 0.5) - Math.abs(b.yes_price - 0.5));
  const candidates = passed.slice(0, CANDIDATE_CAP);

  const filtered_out = fetched_total - candidates.length;
  const passed_eligible = candidates.length;

  const scan_stats = {
    fetched_total,
    passed_eligible,
    filtered_out,
    filter_breakdown: breakdown,
    scan_time: scanTime,
    ttl_cutoff: ttlCutoffIso,
  };

  return { candidates, scan_stats };
}
