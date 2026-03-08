// market_scanner.mjs — Polymarket Gamma API 市场发现（config 驱动）
// 修复：slug 格式为 btc-updown-15m-<timestamp>，需要前缀搜索

import './proxy_agent.mjs';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

export function createScanner(config) {
  const { slug_prefix, window_minutes } = config.market;

  // 从 Gamma API 获取符合 slug_prefix 的 events（按 startDate 降序）
  async function fetchEvents() {
    // 使用 slug_contains 参数做前缀搜索，按时间降序取最新
    const url = `${GAMMA_BASE}/events?limit=20&active=true&order=startDate&ascending=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API failed: ${res.status}`);
    const all = await res.json();
    // 过滤：slug 必须以 slug_prefix 开头
    return all.filter(e => e.slug && e.slug.startsWith(slug_prefix));
  }

  // 解析 event 为 Window 对象
  function parseWindow(event) {
    const markets = event.markets || [];
    if (markets.length < 2) return null;

    let upTokenId   = null;
    let downTokenId = null;

    for (const m of markets) {
      const outcome = (m.outcome || m.outcomeName || '').toLowerCase();
      if (outcome.includes('up') || outcome.includes('higher')) {
        upTokenId = m.clobTokenIds?.[0] || m.conditionId;
      } else if (outcome.includes('down') || outcome.includes('lower')) {
        downTokenId = m.clobTokenIds?.[0] || m.conditionId;
      }
    }

    if (!upTokenId || !downTokenId) return null;

    return {
      event_id:     event.id,
      slug:         event.slug,
      up_token_id:  upTokenId,
      down_token_id: downTokenId,
      window_start: new Date(event.startDate || event.startTime),
      window_end:   new Date(event.endDate   || event.endTime),
      strike_price: event.strikePrice ? parseFloat(event.strikePrice) : null,
    };
  }

  // 找到 start <= now < end 的当前窗口
  async function findCurrentWindow() {
    const events = await fetchEvents();
    const now = new Date();
    for (const event of events) {
      const win = parseWindow(event);
      if (!win) continue;
      if (win.window_start <= now && now < win.window_end) {
        console.log(`[Scanner] Found current window: ${win.slug} end=${win.window_end.toISOString()}`);
        return win;
      }
    }
    console.log(`[Scanner] No active window found (slug_prefix=${slug_prefix})`);
    return null;
  }

  // 找到 start > now 且最近的下一个窗口
  async function findNextWindow() {
    const events = await fetchEvents();
    const now = new Date();
    let nextWin = null;
    for (const event of events) {
      const win = parseWindow(event);
      if (!win) continue;
      if (win.window_start > now) {
        if (!nextWin || win.window_start < nextWin.window_start) {
          nextWin = win;
        }
      }
    }
    return nextWin;
  }

  return { findCurrentWindow, findNextWindow };
}
