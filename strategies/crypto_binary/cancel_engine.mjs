// cancel_engine.mjs — 四重撤单引擎（独立底层模块）
// 工厂函数模式：createCancelEngine(config, orderManager)

/**
 * 四个触发器：
 *   SIGMA      — sigma 跳变超过阈值
 *   TAU        — 距窗口结束时间不足
 *   AGE        — 挂单存活超过最大时长
 *   TICK_SIZE  — tick_size 变更（由 orderbook_monitor 事件驱动）
 */

export const CANCEL_REASONS = {
  SIGMA: 'sigma_threshold',
  TAU: 'tau_min_sec',
  AGE: 'order_age_max_sec',
  TICK_SIZE: 'tick_size_change',
};

export function createCancelEngine(config, orderManager) {
  const {
    sigma_threshold = 0.30,
    tau_min_sec = 60,
    order_age_max_sec = 300,
  } = config.cancel || config.signal || {};

  let lastSigma = null;
  let timer = null;
  const cancelLog = []; // 记录每次撤单原因，供 postmortem 分析
  const latencyHistory = []; // 滚动最近 100 条撤单延迟
  const MAX_LATENCY_HISTORY = 100;

  /**
   * 触发器 1：sigma 跳变检查
   * 由外部（strategy_runner）在每次获得新 sigma 时调用
   */
  function checkSigma(newSigma, windowEnd) {
    if (lastSigma === null) {
      lastSigma = newSigma;
      return false;
    }
    const change = Math.abs(newSigma - lastSigma) / lastSigma;
    lastSigma = newSigma;

    if (change > sigma_threshold) {
      console.warn(`[CancelEngine] SIGMA trigger: change=${(change*100).toFixed(1)}% > ${(sigma_threshold*100).toFixed(0)}%`);
      const t0 = Date.now();
      const cancelled = orderManager.cancelAll(CANCEL_REASONS.SIGMA);
      if (cancelled.length > 0) {
        recordLatency(Date.now() - t0);
        logCancel(CANCEL_REASONS.SIGMA, cancelled.length);
      }
      return true;
    }
    return false;
  }

  /**
   * 触发器 2：时间衰减检查
   * 在轮询循环中每次调用
   */
  function checkTau(windowEnd) {
    if (!windowEnd) return false;
    const secsToEnd = (windowEnd - new Date()) / 1000;
    if (secsToEnd < tau_min_sec && secsToEnd > 0) {
      const openOrders = orderManager.getOpenOrders();
      if (openOrders.length > 0) {
        console.warn(`[CancelEngine] TAU trigger: ${secsToEnd.toFixed(0)}s to end < ${tau_min_sec}s`);
        const t0 = Date.now();
        const cancelled = orderManager.cancelAll(CANCEL_REASONS.TAU);
        if (cancelled.length > 0) {
          recordLatency(Date.now() - t0);
          logCancel(CANCEL_REASONS.TAU, cancelled.length);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * 触发器 3：挂单老化检查
   * 在轮询循环中每次调用
   */
  function checkAge() {
    const now = new Date();
    const openOrders = orderManager.getOpenOrders();
    let triggered = false;

    for (const order of openOrders) {
      const ageMs = now - order.created_at;
      const ageSec = ageMs / 1000;
      if (ageSec > order_age_max_sec) {
        console.warn(`[CancelEngine] AGE trigger: order ${order.order_id.slice(0,8)} age=${ageSec.toFixed(0)}s > ${order_age_max_sec}s`);
        const t0 = Date.now();
        orderManager.cancelOrder(order.order_id);
        recordLatency(Date.now() - t0);
        logCancel(CANCEL_REASONS.AGE, 1);
        triggered = true;
      }
    }
    return triggered;
  }

  /**
   * 触发器 4：tick_size_change 事件处理
   * 由 orderbook_monitor 的 subscribe 回调驱动
   */
  function onTickSizeChange(snapshot) {
    if (!snapshot.tick_size_changed) return false;
    console.warn(`[CancelEngine] TICK_SIZE trigger: tick_size changed, marking all stale`);
    const t0 = Date.now();
    orderManager.markAllStale();
    orderManager.cancelAll(CANCEL_REASONS.TICK_SIZE);
    recordLatency(Date.now() - t0);
    logCancel(CANCEL_REASONS.TICK_SIZE, orderManager.getAllOrders().length);
    return true;
  }

  /**
   * 综合检查（在每次轮询 tick 中调用）
   * @param {object} params
   * @param {number} params.sigma        — 当前波动率
   * @param {Date}   params.windowEnd    — 当前窗口结束时间
   * @param {object} params.snapshot     — OrderbookSnapshot（含 tick_size_changed）
   */
  function check({ sigma, windowEnd, snapshot }) {
    // tick_size_change 优先级最高（立即撤单并标记 stale）
    if (snapshot?.tick_size_changed) {
      onTickSizeChange(snapshot);
      return CANCEL_REASONS.TICK_SIZE;
    }
    if (sigma !== undefined && checkSigma(sigma, windowEnd)) return CANCEL_REASONS.SIGMA;
    if (windowEnd && checkTau(windowEnd)) return CANCEL_REASONS.TAU;
    if (checkAge()) return CANCEL_REASONS.AGE;
    return null;
  }

  function logCancel(reason, count) {
    cancelLog.push({ reason, count, at: new Date() });
  }

  function recordLatency(ms) {
    latencyHistory.push(ms);
    if (latencyHistory.length > MAX_LATENCY_HISTORY) latencyHistory.shift();
  }

  function calcPercentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  function getCancelStats() {
    const byReason = { sigma: 0, tau: 0, age: 0, tick_size_change: 0 };
    let total = 0;
    for (const entry of cancelLog) {
      total += entry.count;
      if (entry.reason === CANCEL_REASONS.SIGMA) byReason.sigma += entry.count;
      else if (entry.reason === CANCEL_REASONS.TAU) byReason.tau += entry.count;
      else if (entry.reason === CANCEL_REASONS.AGE) byReason.age += entry.count;
      else if (entry.reason === CANCEL_REASONS.TICK_SIZE) byReason.tick_size_change += entry.count;
    }
    return {
      total,
      by_reason: byReason,
      latency_ms: {
        p50: calcPercentile(latencyHistory, 0.50),
        p95: calcPercentile(latencyHistory, 0.95),
      },
    };
  }

  /**
   * 获取撤单日志（供 postmortem 统计）
   */
  function getCancelLog() {
    return [...cancelLog];
  }

  /**
   * 重置 sigma 基准（新窗口开始时调用）
   */
  function resetSigma() {
    lastSigma = null;
  }

  return { check, checkSigma, checkTau, checkAge, onTickSizeChange, getCancelLog, getCancelStats, resetSigma };
}
