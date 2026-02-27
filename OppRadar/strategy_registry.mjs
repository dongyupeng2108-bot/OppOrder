/**
 * strategy_registry.mjs
 * M1-T5: Strategy注册表
 *
 * 核心：按strategy_id查找并执行策略插件
 * 新增策略只需import并register，不改pipeline
 */

import { mockStrategy } from './strategies/mock_strategy.mjs';

const registry = new Map();

// 注册内置策略
registry.set(mockStrategy.id, mockStrategy);

/**
 * 注册策略插件
 * @param {object} plugin - { id, version, run }
 */
export function registerStrategy(plugin) {
  if (!plugin.id || typeof plugin.run !== 'function') {
    throw new Error(`Invalid strategy plugin: missing id or run()`);
  }
  registry.set(plugin.id, plugin);
}

/**
 * 按strategy_id执行策略
 * @param {string} strategyId
 * @param {object} snapshot
 * @param {object[]} candidates
 * @param {object} ctx - StrategyContext
 * @returns {object[]} OpportunityCard[]
 */
export function runStrategy(strategyId, snapshot, candidates, ctx) {
  const plugin = registry.get(strategyId) || registry.get('mock_strategy');
  return plugin.run(snapshot, candidates, ctx);
}

/**
 * 列出已注册策略
 */
export function listStrategies() {
  return Array.from(registry.values()).map(p => ({
    id: p.id,
    version: p.version
  }));
}
