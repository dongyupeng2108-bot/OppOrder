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

  // 根据 slug_prefix 推断窗口时长（秒）
  function getWindowDurationSec() {
    if (slug_prefix.includes('5m'))   return 5  * 60;
    if (slug_prefix.includes('15m'))  return 15 * 60;
    if (slug_prefix.includes('1h'))   return 60 * 60;
    if (slug_prefix.includes('4h'))   return 4  * 60 * 60;
    return 5 * 60; // 默认 5 分钟
  }

  // 解析 event 的 token IDs（Up/Down）
  function parseTokenIds(event) {
    const markets = event.markets || [];
    if (markets.length === 0) return null;

    let upTokenId   = null;
    let downTokenId = null;

    // 优先处理单 market + 双 clobTokenIds 结构（实际 Polymarket 格式）
    const firstMarket = markets[0];
    const tokenIds = firstMarket?.clobTokenIds;
    let parsedIds = [];
    if (typeof tokenIds === 'string') {
      try { parsedIds = JSON.parse(tokenIds); } catch (e) { parsedIds = []; }
    } else if (Array.isArray(tokenIds)) {
      parsedIds = tokenIds;
    }

    if (parsedIds.length >= 2) {
      // index 0 = Up，index 1 = Down（Polymarket 约定）
      upTokenId   = parsedIds[0];
      downTokenId = parsedIds[1];
    } else if (markets.length >= 2) {
      // 回退：多 market 结构，通过 outcome 字段识别
      for (const m of markets) {
        const outcome = (m.outcome || m.outcomeName || '').toLowerCase();
        const ids = (() => {
          if (typeof m.clobTokenIds === 'string') {
            try { return JSON.parse(m.clobTokenIds); } catch (e) { return []; }
          }
          return Array.isArray(m.clobTokenIds) ? m.clobTokenIds : [];
        })();
        const tokenId = ids[0] || m.conditionId;
        if (outcome.includes('up') || outcome.includes('higher')) {
          upTokenId = tokenId;
        } else if (outcome.includes('down') || outcome.includes('lower')) {
          downTokenId = tokenId;
        }
      }
    }

    if (!upTokenId || !downTokenId) {
      console.log(`[Scanner] parseTokenIds failed: upTokenId=${upTokenId} downTokenId=${downTokenId} slug=${event.slug}`);
      return null;
    }
    return { upTokenId, downTokenId };
  }

  // 解析 event 为 Window 对象（从 slug 解析时间戳确定窗口）
  function parseWindow(event) {
    const tokens = parseTokenIds(event);
    if (!tokens) return null;

    // 从 slug 末尾提取 Unix 时间戳（秒）
    // slug 格式：btc-updown-5m-1773060600
    const parts = event.slug.split('-');
    const tsStr = parts[parts.length - 1];
    const ts = parseInt(tsStr, 10);
    if (!ts || isNaN(ts)) {
      console.log(`[Scanner] parseWindow: cannot parse timestamp from slug=${event.slug}`);
      return null;
    }

    const windowStart = ts * 1000;
    const windowEnd   = windowStart + getWindowDurationSec() * 1000;

    return {
      event_id:      event.id,
      slug:          event.slug,
      up_token_id:   tokens.upTokenId,
      down_token_id: tokens.downTokenId,
      start_time:    windowStart,
      end_time:      windowEnd,
      end_date:      new Date(windowEnd).toISOString(),
      window_start:  new Date(windowStart),
      window_end:    new Date(windowEnd),
      strike_price:  event.strikePrice ? parseFloat(event.strikePrice) : null,
    };
  }

  // 根据当前时间计算 slug，精确查询当前窗口
  async function findCurrentWindow() {
    try {
      const now = Math.floor(Date.now() / 1000);
      const durationSec = getWindowDurationSec();
      const windowStart = Math.floor(now / durationSec) * durationSec;
      const slug = slug_prefix + windowStart;
      const secsLeft = windowStart + durationSec - now;

      const url = `${GAMMA_BASE}/events?slug=${slug}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!data || data.length === 0) {
        console.log(`[Scanner] No active window found (slug=${slug}, secsLeft=${secsLeft})`);
        return null;
      }

      const event = data[0];
      const win = parseWindow(event);
      if (!win) return null;

      console.log(`[Scanner] Found current window: ${win.slug} end=${win.window_end.toISOString()} secsLeft=${secsLeft}`);
      return win;
    } catch (err) {
      console.error('[Scanner] findCurrentWindow error:', err.message);
      return null;
    }
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
