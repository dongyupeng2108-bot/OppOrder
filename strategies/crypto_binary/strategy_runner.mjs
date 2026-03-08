// strategy_runner.mjs — 策略运行循环（config 驱动）
// 工厂函数模式：createRunner(config)
// 支持三种策略类型：pair_cost_maker (S1), low_price_sniper (S2), edge (BS 方向性)

import { createScanner } from './market_scanner.mjs';
import { createPriceFeed } from './price_feed.mjs';
import { calcVolatility } from './volatility_engine.mjs';
import { calcBSPrices } from './bs_pricer.mjs';
import { createSignalEngine } from './edge_strategy.mjs';
import { createPaperExecutor } from './paper_executor.mjs';
import { createLiveExecutor } from './live_executor.mjs';
import { initPostmortem, recordPostmortem } from './postmortem.mjs';
import { createRegimeDetector } from './regime_detector.mjs';
import { createStrategyRouter } from './strategy_router.mjs';
import { createOrderbookMonitor } from './orderbook_monitor.mjs';
import { createOrderManager } from './order_manager.mjs';
import { createCancelEngine } from './cancel_engine.mjs';
import { createPairTracker } from './pair_tracker.mjs';
import { createMakerStrategy } from './maker_strategy.mjs';
import { createSniperStrategy } from './sniper_strategy.mjs';
import crypto from 'crypto';

export function createRunner(config) {
  const scanner = createScanner(config);
  const priceFeed = createPriceFeed(config);
  const strategyType = config.strategy?.type || 'edge';

  let currentWindow = null;
  const executorMode = config.executor_mode || 'paper';
  let consecutiveLosses = 0;
  const maxConsecutiveLosses = config.risk.consecutive_loss_stop;
  let running = false;
  let priceTimer = null;
  let latestKlines = [];
  let latestPrice = null;
  let lastWindowId = null;

  // --- Edge strategy state (original BS flow) ---
  let signalEngine = null;
  let executor = null;
  let currentFill = null;
  let currentSignalData = null;

  // --- Maker/Sniper strategy state ---
  let regimeDetector = null;
  let router = null;
  let orderbookMonitor = null;
  let orderManager = null;
  let cancelEngine = null;
  let pairTracker = null;

  const configHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').substring(0, 16);

  function initStrategyModules() {
    if (strategyType === 'pair_cost_maker') {
      regimeDetector = createRegimeDetector(config);
      orderManager = createOrderManager(config);
      cancelEngine = createCancelEngine(config, orderManager);
      pairTracker = createPairTracker(config);
      orderbookMonitor = createOrderbookMonitor(config);
      const maker = createMakerStrategy(config, { orderManager, pairTracker, cancelEngine });
      router = createStrategyRouter({ [config.strategy_id]: maker });
      console.log(`[Runner] Strategy type: pair_cost_maker (S1)`);
    } else if (strategyType === 'low_price_sniper') {
      regimeDetector = createRegimeDetector(config);
      orderManager = createOrderManager(config);
      cancelEngine = createCancelEngine(config, orderManager);
      orderbookMonitor = createOrderbookMonitor(config);
      const sniper = createSniperStrategy(config, { orderManager, cancelEngine });
      router = createStrategyRouter({ [config.strategy_id]: sniper });
      console.log(`[Runner] Strategy type: low_price_sniper (S2)`);
    } else {
      // edge (BS directional) — original flow
      signalEngine = createSignalEngine(config);
      executor = executorMode === 'live'
        ? createLiveExecutor(config)
        : createPaperExecutor(config);
      console.log(`[Runner] Strategy type: edge (BS directional)`);
    }
  }

  async function tickEdge() {
    // Original BS edge strategy tick
    if (!latestPrice) return;

    const { vol_window_periods } = config.model || {};
    const periodsPerYear = (365 * 24 * 60) / config.market.window_minutes;
    const sigma = calcVolatility(latestKlines, vol_window_periods, periodsPerYear);

    const S = latestPrice;
    const K = currentWindow.strike_price || S;
    const T = Math.max((currentWindow.window_end - new Date()) / (1000 * 365 * 24 * 3600), 1e-6);
    const r = (config.model || {}).risk_free_rate;
    const bsResult = calcBSPrices(S, K, T, sigma, r);

    console.log(`[Runner] S=${S.toFixed(2)} K=${K.toFixed(2)} T=${(T*365*24*60).toFixed(1)}min sigma=${sigma.toFixed(4)} pUp=${bsResult.pUp.toFixed(4)}`);

    const signal = await signalEngine.evaluate(bsResult, currentWindow);
    if (signal) {
      console.log(`[Runner] *** SIGNAL: ${signal.direction} edge_net=${signal.edge_net.toFixed(4)} ***`);
    }
    if (signal && !currentFill) {
      currentFill = await executor.execute(signal);
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
        strategy_type: 'edge',
        config_hash: configHash,
      };
    }
  }

  async function tickRouter() {
    if (!latestPrice) return;

    const { vol_window_periods } = config.model || {};
    const periodsPerYear = (365 * 24 * 60) / config.market.window_minutes;
    const sigma = calcVolatility(latestKlines, vol_window_periods, periodsPerYear);

    regimeDetector.updateSigma(sigma);
    const regime_score = regimeDetector.getScore();

    // Build snapshot from orderbook monitor — skip tick if not ready yet
    const snapshot = orderbookMonitor ? orderbookMonitor.getLatestSnapshot() : null;
    if (!snapshot || snapshot.mid_up === null) {
      console.warn(`[Runner] [${config.strategy_id}] orderbook not ready, skipping tick...`);
      return;
    }
    const windowEnd = currentWindow.window_end;

    const { results } = router.dispatch({ snapshot, regime_score, sigma, windowEnd });

    for (const r of results) {
      const actionLog = r.actions.join(' | ');
      console.log(`[Runner] [${r.strategy_id}] ${actionLog}`);
    }

    // Record signal data for postmortem
    const ptState = pairTracker?.getState() || {};
    currentSignalData = {
      strategy_id: config.strategy_id,
      event_id: currentWindow.event_id,
      window_start: currentWindow.window_start,
      window_end: currentWindow.window_end,
      direction: null,
      signal_edge_net: null,
      p_theory: null,
      ask_at_signal: null,
      fee_est: null,
      K_strike: currentWindow.strike_price,
      K_binance: latestKlines[latestKlines.length - 1] || null,
      S_at_signal: latestPrice,
      sigma,
      regime_score,
      pair_cost: ptState.pair_cost ?? null,
      balance_ratio: ptState.balance_ratio ?? null,
      strategy_type: strategyType,
      config_hash: configHash,
      config_snapshot_json: JSON.stringify(config),
    };
  }

  function buildSyntheticSnapshot() {
    console.warn(`[Runner] WARNING: using synthetic snapshot (orderbook not ready)`);
    return {
      bid_up: 0.49, ask_up: 0.51, mid_up: 0.50,
      bid_down: 0.49, ask_down: 0.51, mid_down: 0.50,
      spread_up: 0.02, spread_down: 0.02,
      tick_size: 0.01, tick_size_changed: false,
      up_token_id: null, down_token_id: null,
      sampled_at: new Date(),
    };
  }

  async function tick() {
    if (!running) return;
    try {
      // 1. Check/refresh window
      if (!currentWindow || new Date() >= currentWindow.window_end) {
        // 窗口过期 → 立即落盘旧窗口（不等新窗口）
        if (lastWindowId && currentWindow) {
          console.log(`[Runner] Window expired: ${currentWindow.event_id}, settling postmortem...`);
          await settleWindow();
          lastWindowId = null;
        }

        console.log('[Runner] Refreshing window...');
        currentWindow = await scanner.findCurrentWindow();
        if (!currentWindow) {
          console.log('[Runner] No active window, waiting...');
          return;
        }
        console.log(`[Runner] Window: ${currentWindow.event_id}, end: ${currentWindow.window_end.toISOString()}`);
        lastWindowId = currentWindow.event_id;
        latestKlines = await priceFeed.getKlines();

        // 首次启动 orderbook 监控
        if (orderbookMonitor && !orderbookMonitor._started) {
          orderbookMonitor.start(currentWindow.up_token_id, currentWindow.down_token_id);
          orderbookMonitor._started = true;
        } else if (orderbookMonitor && currentWindow.up_token_id) {
          // 窗口切换时更新 token（不重新 start，只更新订阅）
          orderbookMonitor.setTokenIds(currentWindow.up_token_id, currentWindow.down_token_id);
          console.log(`[Runner] OrderbookMonitor token updated for new window: ${currentWindow.slug}`);
        }
      }

      // Window switch mid-window (e.g. event_id changed without expiry)
      if (lastWindowId && lastWindowId !== currentWindow?.event_id) {
        await settleWindow();
      }
      lastWindowId = currentWindow?.event_id || lastWindowId;

      // 2. Strategy-specific tick
      if (strategyType === 'edge') {
        await tickEdge();
      } else {
        await tickRouter();
      }
    } catch (e) {
      console.error(`[Runner] tick error: ${e.message}`);
    }
  }

  async function settleWindow() {
    if (strategyType === 'edge') {
      // Edge strategy settlement
      if (currentFill?.filled) {
        const S_now = latestPrice;
        const settled = S_now >= (currentSignalData?.K_strike || S_now) ? 'UP' : 'DOWN';
        const pnl = executor.settle(currentFill, settled);
        if (pnl < 0) {
          consecutiveLosses++;
          console.warn(`[Runner] Consecutive losses: ${consecutiveLosses}/${maxConsecutiveLosses}`);
          if (consecutiveLosses >= maxConsecutiveLosses) {
            console.error(`[Runner] STOP: consecutive_loss_stop triggered (${consecutiveLosses} losses)`);
            stop();
            return;
          }
        } else {
          consecutiveLosses = 0;
        }
        await recordPostmortem({
          ...currentSignalData,
          paper_fill_price: currentFill.fill_price,
          paper_pnl: pnl,
          symbol: config.price_feed.symbol,
        });
      } else if (currentSignalData) {
        await recordPostmortem({
          ...currentSignalData,
          paper_fill_price: null,
          paper_pnl: null,
          symbol: config.price_feed.symbol,
        });
      }
      currentFill = null;
    } else {
      // Maker/Sniper settlement
      const S_now = latestPrice;
      const settled_outcome = S_now >= (currentSignalData?.K_strike || S_now) ? 'UP' : 'DOWN';
      regimeDetector.updateOutcome(settled_outcome);

      if (currentSignalData) {
        await recordPostmortem({
          ...currentSignalData,
          settled_outcome,
          paper_fill_price: null,
          paper_pnl: null,
          symbol: config.price_feed.symbol,
        });
      }

      // Reset strategies for new window
      router.resetAll();
    }
    currentSignalData = null;
  }

  async function start() {
    if (running) return;
    running = true;
    console.log(`[Runner] Starting strategy: ${config.strategy_id} (type=${strategyType})`);

    await initPostmortem();
    initStrategyModules();

    // Price polling
    priceFeed.startPolling((price) => {
      latestPrice = price;
    });

    // Main loop
    const pollSec = config.signal?.polymarket_poll_sec
      || config.polymarket_poll_sec
      || 5;
    const pollMs = pollSec * 1000;
    priceTimer = setInterval(tick, pollMs);
    tick();
  }

  function stop() {
    running = false;
    priceFeed.stopPolling();
    if (priceTimer) { clearInterval(priceTimer); priceTimer = null; }
    if (orderbookMonitor) orderbookMonitor.stop();
    console.log(`[Runner] Stopped: ${config.strategy_id}`);
  }

  function reload(newConfig) {
    stop();
    return createRunner(newConfig);
  }

  function getRegimeState() {
    if (!regimeDetector) return null;
    return regimeDetector.getRegimeState();
  }

  function getCancelStats() {
    if (!cancelEngine) return null;
    return cancelEngine.getCancelStats();
  }

  function getActiveOrders() {
    if (!orderManager) return [];
    return orderManager.getActiveOrders();
  }

  function getInstanceStats() {
    const ptState = pairTracker ? pairTracker.getState() : null;
    const regimeState = regimeDetector ? regimeDetector.getRegimeState() : null;
    return [{
      strategy_id: config.strategy_id,
      enabled: running,
      regime_score: regimeDetector ? regimeDetector.getScore() : null,
      is_active: running,
      current_window: currentWindow?.event_id || null,
      paper_pnl: null,
      open_orders: orderManager ? orderManager.getOpenOrders().length : 0,
      pair_cost: ptState ? ptState.pair_cost : null,
      volume_score: regimeState ? regimeState.dimensions.volume : null,
    }];
  }

  return { start, stop, reload, getRegimeState, getCancelStats, getActiveOrders, getInstanceStats };
}
