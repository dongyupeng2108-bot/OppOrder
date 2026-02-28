/**
 * polymarket_provider.mjs
 * Fetches market data from the Polymarket Gamma API.
 *
 * Uses Node.js 18+ global fetch (no external dependency).
 *
 * Exports:
 *   fetchMarkets({ limit, maxPages }) -> Promise<NormalizedMarket[]>
 *
 * Each NormalizedMarket:
 *   { opp_id, title, market_url, yes_price, event_time, question, raw }
 */

// Node.js 18+ provides globalThis.fetch built-in — no import needed.

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com/markets';
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 5; // 5 × 100 = 500 max

/**
 * Normalize a raw Polymarket market record into the standard structure.
 */
function normalizeMarket(raw) {
  // Derive opp_id: prefer conditionId, fall back to id
  const opp_id = raw.conditionId || raw.id || String(raw.market_slug || '');

  // YES price: outcomePrices[0] is YES price (string "0.72" → float 0.72)
  let yes_price = NaN;
  if (Array.isArray(raw.outcomePrices) && raw.outcomePrices.length > 0) {
    yes_price = parseFloat(raw.outcomePrices[0]);
  } else if (typeof raw.bestBid === 'number') {
    yes_price = raw.bestBid;
  }

  // Settlement / event time: prefer endDate, then end, then resolutionTime
  const event_time = raw.endDate || raw.end || raw.resolutionTime || null;

  // Market URL
  const market_url = raw.url ||
    (raw.market_slug ? `https://polymarket.com/event/${raw.market_slug}` : '');

  return {
    opp_id,
    title: raw.title || raw.question || '',
    market_url,
    yes_price: isNaN(yes_price) ? null : yes_price,
    event_time,
    question: raw.question || raw.title || '',
    raw,
  };
}

/**
 * Fetch markets from Polymarket Gamma API with pagination.
 *
 * @param {object} options
 * @param {number} [options.limit=100]   - Page size (API max is typically 100)
 * @param {number} [options.maxPages=5]  - Maximum pages to fetch (cap: 500 total)
 * @returns {Promise<NormalizedMarket[]>}
 */
export async function fetchMarkets({ limit = DEFAULT_LIMIT, maxPages = DEFAULT_MAX_PAGES } = {}) {
  const pageSize = Math.min(limit, 100);
  const allMarkets = [];
  let offset = 0;
  let page = 0;

  while (page < maxPages) {
    const requestUrl = `${GAMMA_API_BASE}?limit=${pageSize}&offset=${offset}&active=true&closed=false`;

    let response;
    try {
      response = await fetch(requestUrl, {
        headers: { 'Accept': 'application/json' },
      });
    } catch (networkErr) {
      throw new Error(`[polymarket_provider] Network error fetching ${requestUrl}: ${networkErr.message}`);
    }

    if (!response.ok) {
      throw new Error(`[polymarket_provider] HTTP ${response.status} from Gamma API at ${requestUrl}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`[polymarket_provider] Failed to parse JSON from Gamma API: ${parseErr.message}`);
    }

    // API returns array directly or { data: [...] }
    const records = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);

    if (records.length === 0) break; // no more pages

    for (const raw of records) {
      allMarkets.push(normalizeMarket(raw));
    }

    if (records.length < pageSize) break; // last page

    offset += pageSize;
    page++;
  }

  return allMarkets;
}
