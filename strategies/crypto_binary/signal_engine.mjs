// signal_engine.mjs — 信号生成（config 驱动）
// 工厂函数模式：createSignalEngine(config)

import './proxy_agent.mjs'; // 全局注入代理

const CLOB_BASE = 'https://clob.polymarket.com';

/**
 * Signal 对象格式：
 * {
 *   direction: 'UP' | 'DOWN',
 *   token_id: string,
 *   edge_net: number,
 *   edge_raw: number,
 *   p_theory: number,
 *   ask: number,
 *   fee_est: number,
 *   slippage_est: number,
 *   basis_buffer: number,
 *   spread: number,
 *   created_at: Date
 * }
 */

export function createSignalEngine(config) {
  const {
    edge_net_threshold,
    max_spread,
    stop_signal_before_end_sec,
    basis_buffer,
    slippage_est,
    polymarket_poll_sec,
    fee_cache_ttl_sec,
  } = config.signal;

  let feeCache = { value: null, fetchedAt: 0 };

  // 动态获取 feeRateBps（带 TTL 缓存）
  async function getFeeEst(tokenId) {
    const now = Date.now();
    if (feeCache.value !== null && (now - feeCache.fetchedAt) < fee_cache_ttl_sec * 1000) {
      return feeCache.value;
    }
    try {
      const res = await fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=BUY`);
      if (!res.ok) throw new Error(`CLOB /price failed: ${res.status}`);
      const data = await res.json();
      const feeRate = (data.feeRateBps || 0) / 10000;
      feeCache = { value: feeRate, fetchedAt: now };
      return feeRate;
    } catch (e) {
      console.warn(`[SignalEngine] getFeeEst fallback: ${e.message}`);
      return feeCache.value ?? 0.02; // fallback 2%
    }
  }

  // 获取 best_bid / best_ask
  async function getPrice(tokenId, side) {
    const res = await fetch(`${CLOB_BASE}/price?token_id=${tokenId}&side=${side}`);
    if (!res.ok) throw new Error(`CLOB /price failed: ${res.status} for ${tokenId}`);
    const data = await res.json();
    return parseFloat(data.price);
  }

  /**
   * 根据理论概率和市场价格计算信号
   * @param {{ pUp, pDown }} bsResult — bs_pricer 输出
   * @param {{ up_token_id, down_token_id, window_end }} window
   * @returns {Signal | null}
   */
  async function evaluate(bsResult, window) {
    const now = new Date();
    const secsToEnd = (window.window_end - now) / 1000;

    // 窗口剩余时间不足，停止产出信号
    if (secsToEnd < stop_signal_before_end_sec) {
      console.log(`[SignalEngine] Too close to window end (${secsToEnd.toFixed(0)}s), no signal`);
      return null;
    }

    // 获取 Up/Down 的 best_ask
    const [askUp, askDown, feeEst] = await Promise.all([
      getPrice(window.up_token_id, 'BUY'),
      getPrice(window.down_token_id, 'BUY'),
      getFeeEst(window.up_token_id),
    ]);

    const bidUp = await getPrice(window.up_token_id, 'SELL');
    const bidDown = await getPrice(window.down_token_id, 'SELL');

    const spreadUp = askUp - bidUp;
    const spreadDown = askDown - bidDown;

    // 计算 edge_net
    const edgeNetUp = bsResult.pUp - askUp - feeEst - slippage_est - basis_buffer;
    const edgeNetDown = bsResult.pDown - askDown - feeEst - slippage_est - basis_buffer;

    console.log(`[SignalEngine] pUp=${bsResult.pUp.toFixed(4)} askUp=${askUp.toFixed(4)} spreadUp=${spreadUp.toFixed(4)} edge_net_up=${edgeNetUp.toFixed(4)}`);
    console.log(`[SignalEngine] pDown=${bsResult.pDown.toFixed(4)} askDown=${askDown.toFixed(4)} spreadDown=${spreadDown.toFixed(4)} edge_net_down=${edgeNetDown.toFixed(4)}`);

    // 检查 spread 过大
    const upValid = spreadUp <= max_spread && edgeNetUp > edge_net_threshold;
    const downValid = spreadDown <= max_spread && edgeNetDown > edge_net_threshold;

    if (!upValid && !downValid) {
      console.log(`[SignalEngine] No signal (neither side exceeds threshold ${edge_net_threshold})`);
      return null;
    }

    // 取 edge_net 更大的方向（单腿）
    if (upValid && (!downValid || edgeNetUp >= edgeNetDown)) {
      return {
        direction: 'UP',
        token_id: window.up_token_id,
        edge_net: edgeNetUp,
        edge_raw: bsResult.pUp - askUp,
        p_theory: bsResult.pUp,
        ask: askUp,
        fee_est: feeEst,
        slippage_est,
        basis_buffer,
        spread: spreadUp,
        created_at: now,
      };
    } else {
      return {
        direction: 'DOWN',
        token_id: window.down_token_id,
        edge_net: edgeNetDown,
        edge_raw: bsResult.pDown - askDown,
        p_theory: bsResult.pDown,
        ask: askDown,
        fee_est: feeEst,
        slippage_est,
        basis_buffer,
        spread: spreadDown,
        created_at: now,
      };
    }
  }

  return { evaluate, getFeeEst, getPrice };
}
