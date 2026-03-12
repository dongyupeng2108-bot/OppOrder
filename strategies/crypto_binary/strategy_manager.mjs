/**
 * StrategyManager — 实例生命周期管理
 * 替代 server.mjs 中的单 runner 变量和 globalRunnerRegistry Map
 */

import { resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRunner } from './strategy_runner.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const INSTANCES_DIR = resolve(__dirname, 'instances');

// 实例注册表
// key: instanceName
// value: { runner, desired_state, runtime_state, last_error, last_heartbeat, started_at, config_hash }
const _registry = new Map();

/**
 * 加载实例配置文件
 */
function loadConfig(name) {
  const configPath = resolve(INSTANCES_DIR, `${name}.json`);
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * 计算配置的简单 hash（用于 config_hash 字段）
 */
function hashConfig(config) {
  const str = JSON.stringify(config);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * 扫描 instances 目录，返回所有实例名
 */
function scanInstances() {
  try {
    return readdirSync(INSTANCES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/**
 * 启动单个实例
 * @param {string} name 实例名
 * @returns {{ ok: boolean, error?: string }}
 */
async function startInstance(name) {
  // 已在运行则跳过
  const existing = _registry.get(name);
  if (existing && existing.runtime_state) {
    return { ok: true, msg: 'already running' };
  }

  let config;
  try {
    config = loadConfig(name);
  } catch (err) {
    return { ok: false, error: `config load failed: ${err.message}` };
  }

  const runner = createRunner(config);
  _registry.set(name, {
    runner,
    desired_state: true,
    runtime_state: false,
    last_error: null,
    last_heartbeat: null,
    started_at: null,
    config_hash: hashConfig(config),
  });

  try {
    await runner.start();
    _registry.set(name, {
      ..._registry.get(name),
      runtime_state: true,
      last_error: null,
      last_heartbeat: Date.now(),
      started_at: Date.now(),
    });
    return { ok: true };
  } catch (err) {
    _registry.set(name, {
      ..._registry.get(name),
      runtime_state: false,
      last_error: err.message,
    });
    return { ok: false, error: err.message };
  }
}

/**
 * 停止单个实例
 * @param {string} name 实例名
 */
async function stopInstance(name) {
  const entry = _registry.get(name);
  if (!entry) return { ok: false, error: 'instance not found' };

  try {
    if (entry.runner && typeof entry.runner.stop === 'function') {
      await entry.runner.stop();
    }
  } catch (err) {
    // stop 失败也继续标记为停止
  }

  _registry.set(name, {
    ...entry,
    runtime_state: false,
    last_heartbeat: null,
    desired_state: false,
  });
  return { ok: true };
}

/**
 * 重载单个实例配置（停止旧 runner，用新配置重启）
 * @param {string} name 实例名
 */
async function reloadInstance(name) {
  await stopInstance(name);
  // 重置 desired_state 为 true 再重启
  const entry = _registry.get(name);
  if (entry) {
    _registry.set(name, { ...entry, desired_state: true, runtime_state: false });
  }
  return await startInstance(name);
}

/**
 * 删除实例（先停止，再从注册表移除）
 * 注意：此方法不删除磁盘上的 JSON 文件，文件删除由调用方负责
 * @param {string} name 实例名
 */
async function deleteInstance(name) {
  await stopInstance(name);
  _registry.delete(name);
  return { ok: true };
}

/**
 * 获取所有实例状态
 * 合并磁盘扫描结果和运行时注册表
 */
function getStatus() {
  const diskNames = scanInstances();

  return diskNames.map(name => {
    const entry = _registry.get(name);
    let desiredState = false;
    try {
      const cfg = loadConfig(name);
      desiredState = cfg.enabled !== false; // 默认 true，显式 false 才停
    } catch {
      desiredState = false;
    }

    if (!entry) {
      return {
        name,
        desired_state: desiredState,
        runtime_state: false,
        last_error: null,
        last_heartbeat: null,
        started_at: null,
        config_hash: null,
      };
    }

    return {
      name,
      desired_state: entry.desired_state ?? desiredState,
      runtime_state: entry.runtime_state ?? false,
      last_error: entry.last_error ?? null,
      last_heartbeat: entry.last_heartbeat ?? null,
      started_at: entry.started_at ?? null,
      config_hash: entry.config_hash ?? null,
    };
  });
}

/**
 * 获取单个实例的 runner（供 server.mjs 中需要直接访问 runner 的端点使用）
 * @param {string} name 实例名
 */
function getRunner(name) {
  return _registry.get(name)?.runner ?? null;
}

/**
 * 获取第一个正在运行的 runner（向后兼容，供单 runner 模式的端点使用）
 */
function getActiveRunner() {
  for (const [, entry] of _registry) {
    if (entry.runtime_state && entry.runner) return entry.runner;
  }
  return null;
}

/**
 * 更新实例心跳（供 server.mjs 定时轮询调用）
 * @param {string} name 实例名
 */
function updateHeartbeat(name) {
  const entry = _registry.get(name);
  if (entry && entry.runtime_state) {
    _registry.set(name, { ...entry, last_heartbeat: Date.now() });
  }
}

export {
  startInstance,
  stopInstance,
  reloadInstance,
  deleteInstance,
  getStatus,
  getRunner,
  getActiveRunner,
  updateHeartbeat,
  scanInstances,
};
