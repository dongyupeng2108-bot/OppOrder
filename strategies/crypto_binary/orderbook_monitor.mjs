// orderbook_monitor.mjs — Polymarket 盘口 + tick_size 追踪
// 工厂函数模式：createOrderbookMonitor(config)

import '../../OppRadar/proxy_agent.mjs';

const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * OrderbookSnapshot 格式：
 * {
 *   bid_up, ask_up, mid_up, spread_up,
 *   bid_down, ask_down, mid_down, spread_down,
 *   tick_size,
 *   tick_size_changed: boolean,
 *   sampled_at: Date
 * }
 */

/**
 * 根据价格推断当前 tick_size
 * Polymarket 规则：
 *   price >= 0.96 或 price <= 0.04 → tick_size = 0.001
 *   其余 → tick_size = 0.01
 */
export function inferTickSize(price) {
  if (price >= 0.96 || price <= 0.04) return 0.001;
  return 0.01;
}

/**
 * 将价格向下对齐到 tick_size 的整数倍
 */
export function floorToTick(price, tickSize) {
  return Math.floor(price / tickSize) * tickSize;
}

export function createOrderbookMonitor(config) {
  const pollMs = (config.polymarket_poll_sec || 2) * 1000;

  let timer = null;
  let lastTickSize = null;
  const subscribers = [];

  // 获取单侧的 bid / ask
  async function fetchSide(tokenId) {
    const [bidRes, askRes] = await Promise.all([
      fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=SELL`),
      fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=BUY`),
    ]);
    if (!bidRes.ok || !askRes.ok) throw new Error(`CLOB /price failed for ${tokenId}`);
    const [bidData, askData] = await Promise.all([bidRes.json(), askRes.json()]);
    return {
      bid: parseFloat(bidData.price),
      ask: parseFloat(askData.price),
    };
  }

  async function poll(window) {
    if (!window) return;
    try {
      const [up, down] = await Promise.all([
        fetchSide(window.up_token_id),
        fetchSide(window.down_token_id),
      ]);

      const mid_up = (up.bid + up.ask) / 2;
      const mid_down = (down.bid + down.ask) / 2;
      const spread_up = up.ask - up.bid;
      const spread_down = down.ask - down.bid;

      // tick_size 由 mid_up 推断（UP 侧价格代表市场共识概率）
      const tick_size = inferTickSize(mid_up);
      const tick_size_changed = lastTickSize !== null && lastTickSize !== tick_size;
      lastTickSize = tick_size;

      const snapshot = {
        bid_up: up.bid,
        ask_up: up.ask,
        mid_up,
        spread_up,
        bid_down: down.bid,
        ask_down: down.ask,
        mid_down,
        spread_down,
        tick_size,
        tick_size_changed,
        sampled_at: new Date(),
      };

      if (tick_size_changed) {
        console.warn(`[OrderbookMonitor] tick_size_change: ${lastTickSize} → ${tick_size} mid_up=${mid_up.toFixed(4)}`);
      }

      subscribers.forEach(cb => {
        try { cb(snapshot); } catch (e) {
          console.error('[OrderbookMonitor] subscriber error:', e.message);
        }
      });
    } catch (e) {
      console.error(`[OrderbookMonitor] poll error: ${e.message}`);
    }
  }

  function start(getWindow) {
    if (timer) return;
    timer = setInterval(() => poll(getWindow()), pollMs);
    poll(getWindow()); // 立即执行一次
    console.log('[OrderbookMonitor] Started');
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    console.log('[OrderbookMonitor] Stopped');
  }

  /**
   * 订阅盘口快照更新
   * @param {function} callback - (snapshot) => void
   */
  function subscribe(callback) {
    subscribers.push(callback);
  }

  return { start, stop, subscribe, inferTickSize, floorToTick };
}
