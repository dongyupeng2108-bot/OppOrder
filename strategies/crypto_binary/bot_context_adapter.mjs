import { createPriceFeed } from './price_feed.mjs';

const createDefaultContext = () => ({
  window_id: null,
  last_window_id: null,
  slug: null,
  period: null,
  remaining_sec: null,
  btc_price: null,
  anchor_btc: null,
  atr_5m: null,
  upper_bound: null,
  lower_bound: null,
  bid_yes: null,
  ask_yes: null,
  bid_no: null,
  ask_no: null,
  tick_size: null,
  stale: true,
  updated_at: new Date().toISOString()
});

const asFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const asPositiveNumber = (value) => {
  const num = asFiniteNumber(value);
  return num !== null && num > 0 ? num : null;
};

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const inferPeriod = (slug) => {
  if (!slug || typeof slug !== 'string') return null;
  const parts = slug.split('-');
  if (parts.length < 2) return null;
  const period = parts[parts.length - 2];
  return /^\d+[mh]$/.test(period) ? period : null;
};

export function createBotContextAdapter(options = {}) {
  const getScanner = options.getScanner || (() => null);
  const getOrderbookMonitor = options.getOrderbookMonitor || (() => null);
  const getState = options.getState || (() => null);
  const refreshMs = Number.isFinite(options.windowRefreshMs) ? options.windowRefreshMs : 2000;

  const priceFeed = options.priceFeed || createPriceFeed({
    price_feed: { symbol: 'BTCUSDT', mode: 'ws', poll_sec: 2 },
    regime_detector: { volume_recent_minutes: 3, volume_baseline_minutes: 60 }
  });

  let latestBtcPrice = null;
  let latestPriceAt = null;
  let latestPriceSource = null;
  let lastWindow = null;
  let lastWindowCheckAt = 0;
  let lastDirectPriceFetchAt = 0;
  let directPriceFetchInFlight = null;
  let sourceInitStarted = false;
  let sourceInitError = null;
  let sourceFeedSeen = false;
  let sourceFeedCount = 0;
  let sourceLastFeedAt = null;

  try {
    sourceInitStarted = true;
    priceFeed.subscribe((snapshot) => {
      const price = typeof snapshot === 'number' ? snapshot : snapshot?.price;
      const parsed = asFiniteNumber(price);
      if (parsed !== null) {
        latestBtcPrice = parsed;
        latestPriceAt = new Date().toISOString();
        latestPriceSource = typeof snapshot === 'object' ? (snapshot?.source ?? 'feed') : 'feed';
        sourceFeedSeen = true;
        sourceFeedCount += 1;
        sourceLastFeedAt = latestPriceAt;
      }
    });
    priceFeed.start();
  } catch (error) {
    sourceInitError = error?.message || 'source_init_failed';
  }

  const readWindow = async () => {
    const scanner = getScanner();
    if (!scanner?.findCurrentWindow) return lastWindow;
    const now = Date.now();
    if (now - lastWindowCheckAt < refreshMs && lastWindow) return lastWindow;
    lastWindowCheckAt = now;
    try {
      const current = await scanner.findCurrentWindow();
      if (current) lastWindow = current;
      return current || lastWindow;
    } catch {
      return lastWindow;
    }
  };
  const refreshPriceFromFeed = async () => {
    if (!priceFeed?.getCurrentPrice) return null;
    const now = Date.now();
    if (directPriceFetchInFlight) return directPriceFetchInFlight;
    if (now - lastDirectPriceFetchAt < 800) return asPositiveNumber(latestBtcPrice);
    lastDirectPriceFetchAt = now;
    directPriceFetchInFlight = (async () => {
      try {
        const fetched = await priceFeed.getCurrentPrice();
        const parsed = asPositiveNumber(fetched);
        if (parsed !== null) {
          latestBtcPrice = parsed;
          latestPriceAt = new Date().toISOString();
          latestPriceSource = 'direct_fetch';
        }
        return parsed;
      } catch {
        return asPositiveNumber(latestBtcPrice);
      } finally {
        directPriceFetchInFlight = null;
      }
    })();
    return directPriceFetchInFlight;
  };

  const getContext = async () => {
    const context = createDefaultContext();
    let snapshot = null;
    try {
      snapshot = getOrderbookMonitor()?.getLatestSnapshot?.() || null;
    } catch {
      snapshot = null;
    }

    const windowInfo = await readWindow();
    const state = getState() || {};
    const now = Date.now();
    const endMs = windowInfo?.window_end ? new Date(windowInfo.window_end).getTime() : null;
    const runningWindowReady = state?.running === true && state?.current_window_id != null;
    if (state?.running === true && asPositiveNumber(latestBtcPrice) === null) {
      await refreshPriceFromFeed();
    }

    let resolvedBtcPrice = asPositiveNumber(latestBtcPrice);
    if (resolvedBtcPrice === null) {
      resolvedBtcPrice = asPositiveNumber(windowInfo?.strike_price);
    }
    if (resolvedBtcPrice === null && runningWindowReady) {
      resolvedBtcPrice = asPositiveNumber(state?.anchor_btc);
    }

    context.window_id = windowInfo?.slug ?? null;
    context.last_window_id = state.last_window_id ?? null;
    context.slug = windowInfo?.slug ?? null;
    context.period = inferPeriod(windowInfo?.slug ?? null);
    context.remaining_sec = Number.isFinite(endMs) ? Math.max(0, Math.floor((endMs - now) / 1000)) : null;
    context.btc_price = resolvedBtcPrice;
    context.anchor_btc = asFiniteNumber(state.anchor_btc);
    context.atr_5m = asFiniteNumber(windowInfo?.atr_5m ?? windowInfo?.atr ?? state.atr_5m);
    context.upper_bound = asFiniteNumber(state.upper_bound);
    context.lower_bound = asFiniteNumber(state.lower_bound);
    context.bid_yes = asFiniteNumber(snapshot?.bid_up);
    context.ask_yes = asFiniteNumber(snapshot?.ask_up);
    context.bid_no = asFiniteNumber(snapshot?.bid_down);
    context.ask_no = asFiniteNumber(snapshot?.ask_down);
    context.tick_size = asFiniteNumber(snapshot?.tick_size);
    context.stale = snapshot?.stale ?? true;
    context.updated_at = toIso(snapshot?.sampled_at) || latestPriceAt || new Date().toISOString();
    context._btc_source_trace = {
      source_init_started: sourceInitStarted,
      source_init_error: sourceInitError,
      source_feed_seen: sourceFeedSeen,
      source_feed_count: sourceFeedCount,
      source_last_feed_at: sourceLastFeedAt,
      latest_cache_price: asPositiveNumber(latestBtcPrice),
      latest_cache_at: latestPriceAt,
      latest_cache_source: latestPriceSource
    };
    return context;
  };

  return { getContext };
}
