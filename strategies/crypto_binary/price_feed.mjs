// price_feed.mjs — Binance REST 价格数据（config 驱动）
// 工厂函数模式：createPriceFeed(config)

import '../../OppRadar/proxy_agent.mjs'; // 全局注入代理，覆盖整个进程的所有 fetch

const BINANCE_BASE = 'https://api.binance.com';

/**
 * @param {object} config — 实例配置（btc_15m.json）
 * @returns {{ getCurrentPrice, getKlines, startPolling, stopPolling }}
 */
export function createPriceFeed(config) {
  const { symbol, poll_sec, kline_interval, kline_limit } = config.price_feed;

  let latestPrice = null;
  let latestKlines = [];
  let pollTimer = null;

  // 获取当前现货价格 S
  async function getCurrentPrice() {
    const url = `${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance ticker/price failed: ${res.status}`);
    const data = await res.json();
    latestPrice = parseFloat(data.price);
    return latestPrice;
  }

  // 获取历史 K 线收盘价序列
  async function getKlines() {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${kline_interval}&limit=${kline_limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines failed: ${res.status}`);
    const data = await res.json();
    // klines 格式：[openTime, open, high, low, close, ...]
    latestKlines = data.map(k => parseFloat(k[4])); // 取收盘价
    return latestKlines;
  }

  // 启动轮询（每 poll_sec 秒获取一次价格）
  function startPolling(onPrice) {
    if (pollTimer) return;
    const poll = async () => {
      try {
        const price = await getCurrentPrice();
        if (onPrice) onPrice(price);
      } catch (e) {
        console.error(`[PriceFeed] Poll error: ${e.message}`);
      }
    };
    poll(); // 立即执行一次
    pollTimer = setInterval(poll, poll_sec * 1000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return { getCurrentPrice, getKlines, startPolling, stopPolling };
}
