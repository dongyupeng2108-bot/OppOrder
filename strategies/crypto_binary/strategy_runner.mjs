// strategy_runner.mjs — 策略运行循环（config 驱动）
// 工厂函数模式：createRunner(config)

import { createScanner } from './market_scanner.mjs';
import { createPriceFeed } from './price_feed.mjs';
import { calcVolatility } from './volatility_engine.mjs';
import { calcBSPrices } from './bs_pricer.mjs';
import { createSignalEngine } from './signal_engine.mjs';
import { createPaperExecutor } from '../../shared/trading/paper_executor.mjs';
import { initPostmortem, recordPostmortem } from './postmortem.mjs';

export function createRunner(config) {
  const scanner = createScanner(config);
  const priceFeed = createPriceFeed(config);
  const signalEngine = createSignalEngine(config);

  let currentWindow = null;
  let paperExecutor = createPaperExecutor(config);
  let currentFill = null;        // 当前窗口的模拟持仓
  let currentSignalData = null;  // 记录信号时的数据，供 postmortem 使用
  let lastWindowId = null;       // 上一个窗口的 event_id，用于触发结算
  let running = false;
  let priceTimer = null;
  let marketTimer = null;
  let latestKlines = [];
  let latestPrice = null;

  async function tick() {
    if (!running) return;
    try {
      // 1. 检查/刷新当前窗口
      if (!currentWindow || new Date() >= currentWindow.window_end) {
        console.log('[Runner] Refreshing window...');
        currentWindow = await scanner.findCurrentWindow();
        if (!currentWindow) {
          console.log('[Runner] No active window, waiting...');
          return;
        }
        console.log(`[Runner] Window: ${currentWindow.event_id}, end: ${currentWindow.window_end.toISOString()}`);
        // 刷新 K 线（新窗口时更新一次）
        latestKlines = await priceFeed.getKlines();
      }

      // 窗口切换 → 结算上一个窗口
      if (lastWindowId && lastWindowId !== currentWindow?.event_id) {
        if (currentFill?.filled) {
          // 获取结算结果（用当前价格估算，实际应等 Chainlink）
          const S_now = latestPrice;
          const settled = S_now >= (currentSignalData?.K_strike || S_now) ? 'UP' : 'DOWN';
          const pnl = paperExecutor.settle(currentFill, settled);
          await recordPostmortem({
            ...currentSignalData,
            paper_fill_price: currentFill.fill_price,
            paper_pnl: pnl,
            symbol: config.price_feed.symbol,
          });
        } else {
          // 无信号窗口也记录
          if (currentSignalData) {
            await recordPostmortem({
              ...currentSignalData,
              paper_fill_price: null,
              paper_pnl: null,
              symbol: config.price_feed.symbol,
            });
          }
        }
        currentFill = null;
        currentSignalData = null;
      }
      lastWindowId = currentWindow?.event_id || lastWindowId;

      if (!latestPrice) return;

      // 2. 计算波动率
      const { vol_window_periods } = config.model;
      const periodsPerYear = (365 * 24 * 60) / config.market.window_minutes;
      const sigma = calcVolatility(latestKlines, vol_window_periods, periodsPerYear);

      // 3. 计算 BS 理论价
      const S = latestPrice;
      const K = currentWindow.strike_price || S; // fallback to current price
      const T = Math.max((currentWindow.window_end - new Date()) / (1000 * 365 * 24 * 3600), 1e-6);
      const r = config.model.risk_free_rate;
      const bsResult = calcBSPrices(S, K, T, sigma, r);

      console.log(`[Runner] S=${S.toFixed(2)} K=${K.toFixed(2)} T=${(T*365*24*60).toFixed(1)}min sigma=${sigma.toFixed(4)} pUp=${bsResult.pUp.toFixed(4)}`);

      // 4. 评估信号
      const signal = await signalEngine.evaluate(bsResult, currentWindow);
      if (signal) {
        console.log(`[Runner] *** SIGNAL: ${signal.direction} edge_net=${signal.edge_net.toFixed(4)} ***`);
      }
      if (signal && !currentFill) {
        // 每窗口只执行一次
        currentFill = paperExecutor.execute(signal);
        currentSignalData = {
          strategy_id: config.strategy_id,
          event_id: currentWindow.event_id,
          window_start: currentWindow.window_start,
          window_end: currentWindow.window_end,
          direction: signal.direction,
          signal_edge_net: signal.edge_net,
          p_theory: signal.p_theory,
          ask_at_signal: signal.ask,
          fee_est: signal.fee_est,
          K_strike: currentWindow.strike_price,
          K_binance: latestKlines[latestKlines.length - 1] || null,
          S_at_signal: latestPrice,
          sigma,
        };
      }
    } catch (e) {
      console.error(`[Runner] tick error: ${e.message}`);
    }
  }

  async function start() {
    if (running) return;
    running = true;
    console.log(`[Runner] Starting strategy: ${config.strategy_id}`);

    await initPostmortem();

    // 价格轮询
    priceFeed.startPolling((price) => {
      latestPrice = price;
    });

    // 主循环（每 polymarket_poll_sec 秒触发一次完整 tick）
    const pollMs = config.signal.polymarket_poll_sec * 1000;
    priceTimer = setInterval(tick, pollMs);
    tick(); // 立即执行一次
  }

  function stop() {
    running = false;
    priceFeed.stopPolling();
    if (priceTimer) { clearInterval(priceTimer); priceTimer = null; }
    if (marketTimer) { clearInterval(marketTimer); marketTimer = null; }
    console.log(`[Runner] Stopped: ${config.strategy_id}`);
  }

  // 热更新：重新加载 config，重建模块实例
  function reload(newConfig) {
    stop();
    // 返回新的 runner 实例，由 server.mjs 替换
    return createRunner(newConfig);
  }

  return { start, stop, reload };
}
