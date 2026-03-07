// 策略运行循环 + 配置热更新支持
// B0 阶段：骨架占位，B1 实现完整逻辑

export function createRunner(config) {
  let _config = config;

  function start() {
    console.log(`[Runner:${_config.strategy_id}] Started (stub — full impl in B1)`);
    // TODO: B1 实现 — 启动轮询循环
  }

  function stop() {
    console.log(`[Runner:${_config.strategy_id}] Stopped`);
  }

  function reload(newConfig) {
    _config = newConfig;
    console.log(`[Runner:${_config.strategy_id}] Config reloaded`);
    // TODO: B1 实现 — 重建 scanner / price_feed / signal_engine 模块实例
  }

  return { start, stop, reload };
}
