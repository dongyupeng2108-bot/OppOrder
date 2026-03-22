import { createPriceFeed } from './price_feed.mjs';

const createDefaultContext = () => ({
  window_id: null,
  slug: null,
  period: null,
  remaining_sec: null,
  btc_price: null,
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
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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
  const refreshMs = Number.isFinite(options.windowRefreshMs) ? options.windowRefreshMs : 2000;

  const priceFeed = options.priceFeed || createPriceFeed({
    price_feed: { symbol: 'BTCUSDT', mode: 'rest', poll_sec: 2 },
    regime_detector: { volume_recent_minutes: 3, volume_baseline_minutes: 60 }
  });

  let latestBtcPrice = null;
  let latestPriceAt = null;
  let lastWindow = null;
  let lastWindowCheckAt = 0;

  try {
    priceFeed.subscribe((snapshot) => {
      const price = typeof snapshot === 'number' ? snapshot : snapshot?.price;
      const parsed = asFiniteNumber(price);
      if (parsed !== null) {
        latestBtcPrice = parsed;
        latestPriceAt = new Date().toISOString();
      }
    });
    priceFeed.start();
  } catch {}

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

  const getContext = async () => {
    const context = createDefaultContext();
    let snapshot = null;
    try {
      snapshot = getOrderbookMonitor()?.getLatestSnapshot?.() || null;
    } catch {
      snapshot = null;
    }

    const windowInfo = await readWindow();
    const now = Date.now();
    const endMs = windowInfo?.window_end ? new Date(windowInfo.window_end).getTime() : null;

    context.window_id = windowInfo?.slug ?? null;
    context.slug = windowInfo?.slug ?? null;
    context.period = inferPeriod(windowInfo?.slug ?? null);
    context.remaining_sec = Number.isFinite(endMs) ? Math.max(0, Math.floor((endMs - now) / 1000)) : null;
    context.btc_price = latestBtcPrice ?? asFiniteNumber(windowInfo?.strike_price);
    context.atr_5m = null;
    context.upper_bound = null;
    context.lower_bound = null;
    context.bid_yes = asFiniteNumber(snapshot?.bid_up);
    context.ask_yes = asFiniteNumber(snapshot?.ask_up);
    context.bid_no = asFiniteNumber(snapshot?.bid_down);
    context.ask_no = asFiniteNumber(snapshot?.ask_down);
    context.tick_size = asFiniteNumber(snapshot?.tick_size);
    context.stale = snapshot?.stale ?? true;
    context.updated_at = toIso(snapshot?.sampled_at) || latestPriceAt || new Date().toISOString();
    return context;
  };

  return { getContext };
}
