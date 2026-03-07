// market_scanner.mjs — Polymarket Gamma API 市场发现（config 驱动）
// 工厂函数模式：createScanner(config)

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

/**
 * Window 对象格式：
 * {
 *   event_id: string,
 *   up_token_id: string,
 *   down_token_id: string,
 *   window_start: Date,
 *   window_end: Date,
 *   strike_price: number | null
 * }
 */

/**
 * @param {object} config — 实例配置（btc_15m.json）
 * @returns {{ findCurrentWindow, findNextWindow }}
 */
export function createScanner(config) {
  const { slug_prefix, window_minutes } = config.market;

  // 从 Gamma API 获取符合 slug_prefix 的 events
  async function fetchEvents() {
    const url = `${GAMMA_BASE}/events?slug=${slug_prefix}&limit=10&active=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API failed: ${res.status}`);
    return await res.json();
  }

  // 解析 event 为 Window 对象
  function parseWindow(event) {
    const markets = event.markets || [];
    if (markets.length < 2) return null;

    // 识别 Up/Down token
    let upTokenId = null;
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
      event_id: event.id,
      up_token_id: upTokenId,
      down_token_id: downTokenId,
      window_start: new Date(event.startDate || event.startTime),
      window_end: new Date(event.endDate || event.endTime),
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
        return win;
      }
    }
    return null;
  }

  // 找到 start > now 且最近的下一个窗口（仅预热用，不产出 Signal）
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
