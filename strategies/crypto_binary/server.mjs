import fs from 'fs';
// BTCQDD 独立服务入口
// 端口 53123（默认），支持 --strategy=<id> 和 --port=<n> 参数
// 提供：GET / 健康检查，POST /config/reload 热更新

import { createServer, request as httpRequest } from 'http';
import { execSync, spawn } from 'child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, unlinkSync, renameSync, createReadStream, statSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  startInstance,
  stopInstance,
  reloadInstance,
  getStatus as smGetStatus,
  getRunner,
  getActiveRunner,
  updateHeartbeat,
} from './strategy_manager.mjs';
import { initPostmortem } from './postmortem.mjs';
import { logger, EVENTS } from './logger.mjs';
import { getDb } from './db.mjs';
import { initManualTrade, submitManualOrder, getManualStats } from './manual_trade.mjs';
import { publish, subscribe, unsubscribe, EVENT_TYPES } from './event_bus.mjs';
import { getAttribution, getLossModes, getSensitivity, getDistribution, getCompare } from './postmortem_api.mjs';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { createScanner } from './market_scanner.mjs';
import { createOrderbookMonitor } from './orderbook_monitor.mjs';
import * as strategyRunnerSe from './strategy_runner_se.mjs';
import { createBotLogger } from './bot_logger.mjs';
import { createBotStateStore } from './bot_state.mjs';
import { createBotContextAdapter } from './bot_context_adapter.mjs';
import { decideBotAction } from './bot_strategy.mjs';
import { BOT_STRATEGY_CONTRACT, summarizeIntents } from './bot_strategy_contract.mjs';
import { getDecisionFixtures } from './bot_strategy_fixtures.mjs';
import { createBotOrderLedger } from './bot_order_ledger.mjs';
import { createBotExecutorPaper, BOT_PAPER_ALLOWED_ACTIONS } from './bot_executor_paper.mjs';
import { createBotRunner } from './bot_runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 代理感知 fetch（用于 /klines 等需要翻墙的端点）
const _klinesProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const _klinesDispatcher = _klinesProxyUrl ? new ProxyAgent(_klinesProxyUrl) : null;
async function _proxyFetch(url, opts = {}) {
  if (_klinesDispatcher) return undiciFetch(url, { ...opts, dispatcher: _klinesDispatcher });
  return fetch(url, opts);
}

// 解析命令行参数
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);
const STRATEGY_ID = args.strategy || null;
const PORT = parseInt(args.port || '53123', 10);
const BOT_MODE = process.env.EXECUTOR_MODE || 'paper-staging';
const BOT_TICK_INTERVAL_DEFAULT_MS = 2000;
const BOT_TICK_INTERVAL_MIN_MS = 1000;
const BOT_TICK_INTERVAL_MAX_MS = 5000;
const BOT_POSTMORTEM_STRATEGY_ID = 'bot_console';
const BOT_PERF_PRESET_TODAY = 'today';
const BOT_PERF_PRESET_LAST_7D = 'last_7d';
const BOT_PERF_PRESET_LAST_30_WINDOWS = 'last_30_windows';
const BOT_TEST_REPO_ROOT = resolve(__dirname, '..', '..');
const BOT_ACCOUNT_CACHE_PATH = resolve(BOT_TEST_REPO_ROOT, 'data', 'crypto_binary', 'pm_account_cache.json');
const BOT_RUNTIME_RECOVERY_PATH = resolve(BOT_TEST_REPO_ROOT, 'data', 'crypto_binary', `bot_runtime_recovery_${PORT}.json`);
const BOT_SECRETS_PATH_CONFIG = resolve(BOT_TEST_REPO_ROOT, 'config', 'secrets_path.json');
const BOT_TEST_RUNNER_DIR = resolve(BOT_TEST_REPO_ROOT, 'data', 'crypto_binary', 'test_runner');
const BOT_TEST_REPORTS_ROOT = resolve(BOT_TEST_REPO_ROOT, 'rules', 'task-reports');
const BOT_TEST_STATE_IDLE = 'idle';
const BOT_TEST_STATE_RUNNING = 'running';
const BOT_TEST_STATE_PASSED = 'passed';
const BOT_TEST_STATE_FAILED = 'failed';
const toLadderRows = (prices, size) => prices.map((price) => ({ price, size, tp_price: 1 }));
const BOT_CONFIG_DEFAULTS = {
  open_delay_sec: 10,
  ladder_prices: [...BOT_STRATEGY_CONTRACT.defaults.ladder_prices],
  ladder_size: BOT_STRATEGY_CONTRACT.defaults.ladder_size,
  atr_multiple: 1.2,
  cancel_all_remaining_sec: 100,
  up_ladder: toLadderRows(BOT_STRATEGY_CONTRACT.defaults.ladder_prices, BOT_STRATEGY_CONTRACT.defaults.ladder_size),
  down_ladder: toLadderRows(BOT_STRATEGY_CONTRACT.defaults.ladder_prices, BOT_STRATEGY_CONTRACT.defaults.ladder_size),
  up_cancel: { before_end_sec: 100, formula: '' },
  down_cancel: { before_end_sec: 100, formula: '' }
};
const BOT_CONFIG_INTERNAL_DEFAULTS = {
  open_delay_sec: BOT_CONFIG_DEFAULTS.open_delay_sec,
  ladder_prices: [...BOT_CONFIG_DEFAULTS.ladder_prices],
  ladder_size: BOT_CONFIG_DEFAULTS.ladder_size,
  atr_multiplier: BOT_CONFIG_DEFAULTS.atr_multiple,
  cancel_all_remaining_sec: BOT_CONFIG_DEFAULTS.cancel_all_remaining_sec,
  up_ladder: BOT_CONFIG_DEFAULTS.up_ladder.map((item) => ({ ...item })),
  down_ladder: BOT_CONFIG_DEFAULTS.down_ladder.map((item) => ({ ...item })),
  up_cancel: { ...BOT_CONFIG_DEFAULTS.up_cancel },
  down_cancel: { ...BOT_CONFIG_DEFAULTS.down_cancel }
};
let botConfigCurrent = {
  ...BOT_CONFIG_DEFAULTS,
  ladder_prices: [...BOT_CONFIG_DEFAULTS.ladder_prices],
  up_ladder: BOT_CONFIG_DEFAULTS.up_ladder.map((item) => ({ ...item })),
  down_ladder: BOT_CONFIG_DEFAULTS.down_ladder.map((item) => ({ ...item })),
  up_cancel: { ...BOT_CONFIG_DEFAULTS.up_cancel },
  down_cancel: { ...BOT_CONFIG_DEFAULTS.down_cancel }
};
const botRunnerConfig = {
  ...BOT_CONFIG_INTERNAL_DEFAULTS,
  ladder_prices: [...BOT_CONFIG_INTERNAL_DEFAULTS.ladder_prices],
  up_ladder: BOT_CONFIG_INTERNAL_DEFAULTS.up_ladder.map((item) => ({ ...item })),
  down_ladder: BOT_CONFIG_INTERNAL_DEFAULTS.down_ladder.map((item) => ({ ...item })),
  up_cancel: { ...BOT_CONFIG_INTERNAL_DEFAULTS.up_cancel },
  down_cancel: { ...BOT_CONFIG_INTERNAL_DEFAULTS.down_cancel }
};
let botActiveRuntimeConfig = null;
let botLastRunSnapshot = null;
let botPendingStopReason = null;
let botRuntimeWasRunning = false;
let botRunActionSummary = [];
let botLastTickResult = null;
let botRecoveryHydrated = false;
let botAccountSnapshotCache = null;
let botAccountSnapshotCachedAt = 0;
let botTestRunnerState = {
  state: BOT_TEST_STATE_IDLE,
  task_id: null,
  module_key: 'allchain',
  module_label: '全链测试',
  run_id: null,
  started_at: null,
  finished_at: null,
  overall_pass: null,
  current_step: null,
  log_file: null,
  result_file: null,
  last_error: null,
  child: null
};
const ensureBotTestRunnerDir = () => {
  if (!existsSync(BOT_TEST_RUNNER_DIR)) {
    mkdirSync(BOT_TEST_RUNNER_DIR, { recursive: true });
  }
};
const resolveBotTestReportMonth = (taskId) => {
  const m = String(taskId || '').match(/^(\d{2})(\d{2})\d{2}_\d+$/);
  if (m) return `20${m[1]}-${m[2]}`;
  return new Date().toISOString().slice(0, 7);
};
const resolveBotTestResultPath = (taskId, moduleKey, runId) => {
  const month = resolveBotTestReportMonth(taskId);
  const safeModule = String(moduleKey || 'allchain').replace(/[^\w-]/g, '_');
  const safeRun = String(runId || '0').replace(/[^\w-]/g, '_');
  return resolve(BOT_TEST_REPORTS_ROOT, month, `${taskId}_${safeModule}_${safeRun}_verify_all_manual.json`);
};
const appendBotTestRunnerLog = (text) => {
  if (!botTestRunnerState.log_file) return;
  try {
    fs.appendFileSync(botTestRunnerState.log_file, text);
  } catch {}
};
const getBotTestStatusSnapshot = () => ({
  state: botTestRunnerState.state,
  task_id: botTestRunnerState.task_id,
  module_key: botTestRunnerState.module_key,
  module_label: botTestRunnerState.module_label,
  started_at: botTestRunnerState.started_at,
  finished_at: botTestRunnerState.finished_at,
  overall_pass: botTestRunnerState.overall_pass,
  current_step: botTestRunnerState.current_step,
  log_file: botTestRunnerState.log_file,
  result_file: botTestRunnerState.result_file,
  run_id: botTestRunnerState.run_id,
  last_error: botTestRunnerState.last_error
});
const BOT_TEST_MODULE_LABELS = {
  module1: '模块1 策略与输入',
  module2: '模块2 执行引擎',
  module3: '模块3 实时监控',
  module4: '模块4 运行结果',
  module5: '模块5 版本测试/保障',
  allchain: '全链测试'
};
const launchBotTestRun = ({ taskId, simulateFail = false, moduleKey = 'allchain' }) => {
  if (botTestRunnerState.state === BOT_TEST_STATE_RUNNING) {
    return { ok: true, started: false, already_running: true, status: getBotTestStatusSnapshot() };
  }
  const normalizedModuleKey = String(moduleKey || 'allchain').toLowerCase();
  const moduleLabel = BOT_TEST_MODULE_LABELS[normalizedModuleKey];
  if (!moduleLabel) {
    return { ok: false, started: false, already_running: false, error: `unsupported module_key=${normalizedModuleKey}` };
  }
  ensureBotTestRunnerDir();
  const startedAt = new Date().toISOString();
  const runId = `${Date.now()}`;
  const logFile = resolve(BOT_TEST_RUNNER_DIR, `${taskId}_${runId}.log`);
  const resultFile = resolveBotTestResultPath(taskId, normalizedModuleKey, runId);
  writeFileSync(logFile, '');
  botTestRunnerState = {
    ...botTestRunnerState,
    state: BOT_TEST_STATE_RUNNING,
    task_id: taskId,
    module_key: normalizedModuleKey,
    module_label: moduleLabel,
    run_id: runId,
    started_at: startedAt,
    finished_at: null,
    overall_pass: null,
    current_step: 'launching',
    log_file: logFile,
    result_file: resultFile,
    last_error: null,
    child: null
  };
  appendBotTestRunnerLog(`[${startedAt}] start task_id=${taskId} module_key=${normalizedModuleKey}\n`);
  const env = { ...process.env };
  if (simulateFail) {
    env.VERIFY_ALL_FORCE_FAIL = '1';
    appendBotTestRunnerLog(`[${startedAt}] simulate_fail=true\n`);
  }
  const child = spawn(process.execPath, ['scripts/verify_all_manual.mjs', `--task_id=${taskId}`, `--module=${normalizedModuleKey}`, `--output=${resultFile}`], {
    cwd: BOT_TEST_REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  botTestRunnerState.child = child;
  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    appendBotTestRunnerLog(text);
    if (text.includes('VERIFY_ALL_OUTPUT=')) {
      botTestRunnerState.current_step = 'collecting_results';
    } else {
      botTestRunnerState.current_step = 'running';
    }
  });
  child.stderr.on('data', (chunk) => {
    appendBotTestRunnerLog(String(chunk));
    botTestRunnerState.current_step = 'running';
  });
  child.on('error', (err) => {
    const finishedAt = new Date().toISOString();
    appendBotTestRunnerLog(`[${finishedAt}] child_error=${err.message}\n`);
    botTestRunnerState = {
      ...botTestRunnerState,
      state: BOT_TEST_STATE_FAILED,
      finished_at: finishedAt,
      overall_pass: false,
      current_step: 'finished',
      last_error: err.message,
      child: null
    };
  });
  child.on('close', (code) => {
    const finishedAt = new Date().toISOString();
    let parsed = null;
    try {
      if (existsSync(resultFile)) {
        parsed = JSON.parse(readFileSync(resultFile, 'utf8'));
      }
    } catch {}
    const overallPass = code === 0 && parsed?.overall_pass === true;
    appendBotTestRunnerLog(`[${finishedAt}] exit_code=${code ?? 1} overall_pass=${overallPass}\n`);
    botTestRunnerState = {
      ...botTestRunnerState,
      state: overallPass ? BOT_TEST_STATE_PASSED : BOT_TEST_STATE_FAILED,
      finished_at: finishedAt,
      overall_pass: overallPass,
      current_step: 'finished',
      last_error: overallPass ? null : `verify_all_manual(${normalizedModuleKey}) exit code ${code ?? 1}`,
      child: null
    };
  });
  return { ok: true, started: true, already_running: false, status: getBotTestStatusSnapshot() };
};
const cloneLadderRows = (rows = []) => rows.map((item) => ({
  price: Number(item.price),
  size: Number(item.size),
  tp_price: Number(item.tp_price)
}));
const cloneCancelConfig = (value = {}) => ({
  before_end_sec: Number(value.before_end_sec),
  formula: typeof value.formula === 'string' ? value.formula : ''
});
const cloneBotConfig = (value) => ({
  open_delay_sec: Number(value.open_delay_sec),
  ladder_prices: [...value.ladder_prices],
  ladder_size: Number(value.ladder_size),
  atr_multiple: Number(value.atr_multiple),
  cancel_all_remaining_sec: Number(value.cancel_all_remaining_sec),
  up_ladder: cloneLadderRows(value.up_ladder),
  down_ladder: cloneLadderRows(value.down_ladder),
  up_cancel: cloneCancelConfig(value.up_cancel),
  down_cancel: cloneCancelConfig(value.down_cancel)
});
const toInternalRunnerConfig = (value) => ({
  open_delay_sec: Number(value.open_delay_sec),
  ladder_prices: [...value.ladder_prices],
  ladder_size: Number(value.ladder_size),
  atr_multiplier: Number(value.atr_multiple),
  cancel_all_remaining_sec: Number(value.cancel_all_remaining_sec),
  up_ladder: cloneLadderRows(value.up_ladder),
  down_ladder: cloneLadderRows(value.down_ladder),
  up_cancel: cloneCancelConfig(value.up_cancel),
  down_cancel: cloneCancelConfig(value.down_cancel)
});
const setBotConfigCurrent = (nextConfig, options = {}) => {
  const shouldPersist = options.persist !== false;
  botConfigCurrent = cloneBotConfig(nextConfig);
  const internal = toInternalRunnerConfig(botConfigCurrent);
  botRunnerConfig.open_delay_sec = internal.open_delay_sec;
  botRunnerConfig.ladder_prices = [...internal.ladder_prices];
  botRunnerConfig.ladder_size = internal.ladder_size;
  botRunnerConfig.atr_multiplier = internal.atr_multiplier;
  botRunnerConfig.cancel_all_remaining_sec = internal.cancel_all_remaining_sec;
  botRunnerConfig.up_ladder = cloneLadderRows(internal.up_ladder);
  botRunnerConfig.down_ladder = cloneLadderRows(internal.down_ladder);
  botRunnerConfig.up_cancel = cloneCancelConfig(internal.up_cancel);
  botRunnerConfig.down_cancel = cloneCancelConfig(internal.down_cancel);
  if (botState.getState().running === true) {
    botActiveRuntimeConfig = cloneBotConfig(botConfigCurrent);
  }
  if (shouldPersist) {
    persistBotRecoverySnapshot();
  }
};
const getBotConfigSnapshot = () => cloneBotConfig(botConfigCurrent);
const getBotActiveRuntimeConfig = () => (botActiveRuntimeConfig ? cloneBotConfig(botActiveRuntimeConfig) : null);
const getBotLastRunSnapshot = () => (botLastRunSnapshot ? { ...botLastRunSnapshot, active_config: cloneBotConfig(botLastRunSnapshot.active_config) } : null);
const syncRunnerConfigFromSavedConfig = () => {
  const internal = toInternalRunnerConfig(botConfigCurrent);
  botRunnerConfig.open_delay_sec = internal.open_delay_sec;
  botRunnerConfig.ladder_prices = [...internal.ladder_prices];
  botRunnerConfig.ladder_size = internal.ladder_size;
  botRunnerConfig.atr_multiplier = internal.atr_multiplier;
  botRunnerConfig.cancel_all_remaining_sec = internal.cancel_all_remaining_sec;
  botRunnerConfig.up_ladder = cloneLadderRows(internal.up_ladder);
  botRunnerConfig.down_ladder = cloneLadderRows(internal.down_ladder);
  botRunnerConfig.up_cancel = cloneCancelConfig(internal.up_cancel);
  botRunnerConfig.down_cancel = cloneCancelConfig(internal.down_cancel);
};
const toFiniteOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const readJsonSafe = (filePath) => {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};
const readTextSafe = (filePath) => {
  try {
    if (!existsSync(filePath)) return null;
    const value = String(readFileSync(filePath, 'utf8') || '').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
};
const resolveSecretsDir = () => {
  const cfg = readJsonSafe(BOT_SECRETS_PATH_CONFIG);
  const raw = typeof cfg?.secrets_dir === 'string' ? cfg.secrets_dir : null;
  if (!raw) return null;
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return raw.replace('${USERPROFILE}', userProfile);
};
const readPmCredentialsSnapshot = () => {
  const secretsDir = resolveSecretsDir();
  if (!secretsDir) return { accountAlias: null };
  const apiKey = readTextSafe(resolve(secretsDir, 'polymarket_api_key.txt'));
  if (!apiKey) return { accountAlias: null };
  const fp = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8).toUpperCase();
  return { accountAlias: `PM-${fp}` };
};
const pickNestedNumber = (payload, keys) => {
  if (!payload || typeof payload !== 'object') return null;
  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of keys) {
      const value = current[key];
      const num = toFiniteOrNull(value);
      if (num !== null) return num;
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
};
const pickNestedString = (payload, keys) => {
  if (!payload || typeof payload !== 'object') return null;
  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of keys) {
      const value = current[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
};
const fetchSignerJson = async (pathname) => {
  return await new Promise((resolveResult) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: 53199,
      path: pathname,
      method: 'GET',
      timeout: 1200
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          resolveResult({ ok: false, path: pathname, status, payload: null });
          return;
        }
        try {
          resolveResult({ ok: true, path: pathname, status, payload: JSON.parse(raw) });
        } catch {
          resolveResult({ ok: false, path: pathname, status, payload: null });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolveResult({ ok: false, path: pathname, status: null, payload: null });
    });
    req.on('error', () => {
      resolveResult({ ok: false, path: pathname, status: null, payload: null });
    });
    req.end();
  });
};
const getBotAccountSnapshot = async () => {
  const now = Date.now();
  if (botAccountSnapshotCache && (now - botAccountSnapshotCachedAt) < 15_000) {
    return botAccountSnapshotCache;
  }
  const cachedFile = readJsonSafe(BOT_ACCOUNT_CACHE_PATH);
  const signerHealth = await fetchSignerJson('/health');
  const signerAccount = await fetchSignerJson('/account');
  const signerBalance = await fetchSignerJson('/balance');
  const signerWallet = await fetchSignerJson('/wallet');
  const signerReadResults = [signerAccount, signerBalance, signerWallet];
  const signerPayload = signerReadResults.find((item) => item?.ok && item?.payload && typeof item.payload === 'object')?.payload || null;
  const nameFromSigner = pickNestedString(signerPayload, ['pm_account_name', 'account_name', 'name', 'display_name', 'address', 'wallet_address']);
  const balanceFromSigner = pickNestedNumber(signerPayload, ['pm_balance_usd', 'balance_usd', 'balance', 'currentBalance', 'usdc_balance', 'buyingPower', 'available_balance']);
  const updatedAtFromSigner = pickNestedString(signerPayload, ['pm_balance_updated_at', 'updated_at', 'lastUpdated', 'timestamp']);
  const creds = readPmCredentialsSnapshot();
  const accountName = nameFromSigner || cachedFile?.pm_account_name || creds.accountAlias || null;
  const balance = balanceFromSigner ?? toFiniteOrNull(cachedFile?.pm_balance_usd);
  const updatedAt = updatedAtFromSigner || cachedFile?.pm_balance_updated_at || null;
  const signerHealthy = signerHealth?.ok && String(signerHealth?.payload?.status || '').toLowerCase() === 'ok';
  const hasReadOk = signerReadResults.some((item) => item?.ok);
  const allRead404 = signerReadResults.every((item) => item && item.ok === false && item.status === 404);
  let accountReadStatus = 'OK';
  if (balanceFromSigner === null) {
    if (!signerHealthy) accountReadStatus = 'SIGNER_UNAVAILABLE';
    else if (allRead404) accountReadStatus = 'SIGNER_BALANCE_UNSUPPORTED';
    else if (hasReadOk) accountReadStatus = 'EMPTY_BALANCE_RESPONSE';
    else accountReadStatus = 'ACCOUNT_READ_FAILED';
  }
  const snapshot = {
    pm_account_name: accountName,
    pm_balance_usd: balance,
    pm_balance_updated_at: updatedAt,
    pm_balance_change_today_usd: null,
    today_change_source: null,
    source: {
      account_name: nameFromSigner ? 'signer' : (creds.accountAlias ? 'secrets_api_key_fingerprint' : null),
      balance: balanceFromSigner !== null ? 'signer' : (balance !== null ? 'cache' : null),
      today_change: null
    },
    account_read_status: accountReadStatus,
    account_read_trace: [
      { path: signerHealth?.path || '/health', status: signerHealth?.status ?? null, ok: Boolean(signerHealth?.ok) },
      ...signerReadResults.map((item) => ({ path: item.path, status: item.status ?? null, ok: Boolean(item.ok) }))
    ]
  };
  if (accountName || balance !== null || updatedAt) {
    try {
      writeFileSync(BOT_ACCOUNT_CACHE_PATH, `${JSON.stringify({
        pm_account_name: accountName,
        pm_balance_usd: balance,
        pm_balance_updated_at: updatedAt,
        cached_at: new Date().toISOString()
      }, null, 2)}\n`, 'utf8');
    } catch {}
  }
  botAccountSnapshotCache = snapshot;
  botAccountSnapshotCachedAt = now;
  return snapshot;
};
const normalizeBotActionType = (message) => {
  const text = String(message || '');
  if (text.includes('PLACE_LADDER')) return 'PLACE_LADDER';
  if (text.includes('CANCEL_OPEN')) return 'CANCEL_OPEN';
  if (text.includes('FLATTEN_POSITION')) return 'FLATTEN_POSITION';
  return null;
};
const registerBotRunAction = (message) => {
  const actionType = normalizeBotActionType(message);
  if (!actionType) return;
  if (!botRunActionSummary.includes(actionType)) {
    botRunActionSummary = [...botRunActionSummary, actionType];
  }
};
const ensureBotPostmortemColumns = async () => {
  if (!db) return;
  const statements = [
    'ALTER TABLE cb_postmortem ADD COLUMN bot_stop_reason TEXT',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_completed_at TEXT',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_window_id TEXT',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_filled_total REAL',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_cancelled_total REAL',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_realized_gross_pnl_total REAL',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_unrealized_gross_pnl_total REAL',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_active_config_json TEXT',
    'ALTER TABLE cb_postmortem ADD COLUMN bot_action_summary TEXT'
  ];
  for (const sql of statements) {
    try { await db.run(sql); } catch (_) {}
  }
};
const writeBotPostmortem = async (snapshot) => {
  if (!db || !snapshot) return;
  const completedAt = snapshot.completed_at || new Date().toISOString();
  const windowId = snapshot.current_window_id || null;
  const eventId = windowId || `bot-${Date.parse(completedAt) || Date.now()}`;
  const actionSummary = botRunActionSummary.length ? botRunActionSummary : ['NO_ACTION'];
  await db.run(`
    INSERT INTO cb_postmortem (
      strategy_id,
      event_id,
      window_start,
      window_end,
      paper_pnl,
      strategy_type,
      config_snapshot_json,
      created_at,
      bot_stop_reason,
      bot_completed_at,
      bot_window_id,
      bot_filled_total,
      bot_cancelled_total,
      bot_realized_gross_pnl_total,
      bot_unrealized_gross_pnl_total,
      bot_active_config_json,
      bot_action_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    BOT_POSTMORTEM_STRATEGY_ID,
    eventId,
    snapshot.completed_at || completedAt,
    completedAt,
    snapshot.realized_gross_pnl_total ?? 0,
    'bot_console',
    JSON.stringify(snapshot.active_config || {}),
    completedAt,
    snapshot.stop_reason || null,
    completedAt,
    windowId,
    snapshot.filled_total ?? 0,
    snapshot.cancelled_total ?? 0,
    snapshot.realized_gross_pnl_total ?? 0,
    snapshot.unrealized_gross_pnl_total ?? 0,
    JSON.stringify(snapshot.active_config || {}),
    JSON.stringify(actionSummary)
  ]);
};
const normalizePerformancePreset = (value) => {
  if (value === BOT_PERF_PRESET_LAST_7D) return BOT_PERF_PRESET_LAST_7D;
  if (value === BOT_PERF_PRESET_LAST_30_WINDOWS) return BOT_PERF_PRESET_LAST_30_WINDOWS;
  return BOT_PERF_PRESET_TODAY;
};
const queryBotPerformanceSummary = async (presetRaw, includeRows = false) => {
  if (!db) return null;
  const preset = normalizePerformancePreset(presetRaw);
  const rows = await db.all(`
    SELECT
      id,
      bot_completed_at,
      bot_window_id,
      bot_filled_total,
      bot_cancelled_total,
      bot_realized_gross_pnl_total,
      bot_unrealized_gross_pnl_total
    FROM cb_postmortem
    WHERE strategy_id = ? AND bot_completed_at IS NOT NULL
    ORDER BY bot_completed_at DESC, id DESC
    LIMIT 2000
  `, [BOT_POSTMORTEM_STRATEGY_ID]);
  const now = Date.now();
  let filtered = rows;
  if (preset === BOT_PERF_PRESET_TODAY) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const startTs = start.getTime();
    filtered = rows.filter((row) => {
      const ts = Date.parse(row.bot_completed_at || '');
      return !Number.isNaN(ts) && ts >= startTs && ts <= now;
    });
  } else if (preset === BOT_PERF_PRESET_LAST_7D) {
    const startTs = now - (7 * 24 * 60 * 60 * 1000);
    filtered = rows.filter((row) => {
      const ts = Date.parse(row.bot_completed_at || '');
      return !Number.isNaN(ts) && ts >= startTs && ts <= now;
    });
  } else if (preset === BOT_PERF_PRESET_LAST_30_WINDOWS) {
    filtered = rows.slice(0, 30);
  }
  const windowCount = filtered.length;
  const filledTotal = filtered.reduce((acc, row) => acc + (toFiniteOrNull(row.bot_filled_total) ?? 0), 0);
  const cancelledTotal = filtered.reduce((acc, row) => acc + (toFiniteOrNull(row.bot_cancelled_total) ?? 0), 0);
  const realizedTotal = filtered.reduce((acc, row) => acc + (toFiniteOrNull(row.bot_realized_gross_pnl_total) ?? 0), 0);
  const unrealizedTotal = filtered.reduce((acc, row) => acc + (toFiniteOrNull(row.bot_unrealized_gross_pnl_total) ?? 0), 0);
  const avgRealized = windowCount > 0 ? (realizedTotal / windowCount) : 0;
  const avgUnrealized = windowCount > 0 ? (unrealizedTotal / windowCount) : 0;
  const payload = {
    preset,
    window_count: windowCount,
    filled_total: filledTotal,
    cancelled_total: cancelledTotal,
    realized_gross_pnl_total: realizedTotal,
    unrealized_gross_pnl_total: unrealizedTotal,
    avg_realized_gross_pnl_per_window: avgRealized,
    avg_unrealized_gross_pnl_per_window: avgUnrealized,
    running_window_excluded: true,
    sample_postmortem_rows: filtered.slice(0, 10).map((row) => ({
      id: row.id ?? null,
      window_id: row.bot_window_id ?? null,
      completed_at: row.bot_completed_at ?? null,
      filled_total: toFiniteOrNull(row.bot_filled_total) ?? 0,
      cancelled_total: toFiniteOrNull(row.bot_cancelled_total) ?? 0,
      realized_gross_pnl_total: toFiniteOrNull(row.bot_realized_gross_pnl_total) ?? 0,
      unrealized_gross_pnl_total: toFiniteOrNull(row.bot_unrealized_gross_pnl_total) ?? 0
    }))
  };
  if (includeRows) {
    payload.participating_postmortem_rows = filtered.map((row) => ({
      id: row.id ?? null,
      window_id: row.bot_window_id ?? null,
      completed_at: row.bot_completed_at ?? null,
      filled_total: toFiniteOrNull(row.bot_filled_total) ?? 0,
      cancelled_total: toFiniteOrNull(row.bot_cancelled_total) ?? 0,
      realized_gross_pnl_total: toFiniteOrNull(row.bot_realized_gross_pnl_total) ?? 0,
      unrealized_gross_pnl_total: toFiniteOrNull(row.bot_unrealized_gross_pnl_total) ?? 0
    }));
  }
  return payload;
};
const finalizeBotRunSnapshot = (stopReason) => {
  const state = botState.getState();
  const summary = getBotPaperSummaryScoped();
  const scopedFilledTotal = getScopedFilledTotalForState(state, state?.current_window_id ?? null);
  const activeConfig = getBotActiveRuntimeConfig() || getBotConfigSnapshot();
  const completedAt = new Date().toISOString();
  botLastRunSnapshot = {
    stop_reason: stopReason,
    completed_at: completedAt,
    current_window_id: state.current_window_id ?? null,
    phase: state.phase ?? null,
    filled_total: toFiniteOrNull(scopedFilledTotal) ?? 0,
    cancelled_total: toFiniteOrNull(summary?.cancelled_total) ?? 0,
    realized_gross_pnl_total: toFiniteOrNull(summary?.realized_gross_pnl_total) ?? 0,
    unrealized_gross_pnl_total: toFiniteOrNull(summary?.unrealized_gross_pnl_total) ?? 0,
    active_config: cloneBotConfig(activeConfig)
  };
  const postmortemSnapshot = { ...botLastRunSnapshot, action_summary: [...botRunActionSummary] };
  writeBotPostmortem(postmortemSnapshot).catch((err) => {
    botLogger.log({
      level: 'error',
      source: 'server',
      event: 'BOT_POSTMORTEM_WRITE_FAILED',
      message: err.message,
      mode: BOT_MODE,
      window_id: state.current_window_id ?? null
    });
  });
  botLogger.log({
    level: 'info',
    source: 'server',
    event: 'BOT_RUN_SNAPSHOT',
    message: stopReason,
    mode: BOT_MODE,
    window_id: state.current_window_id ?? null,
    data: { ...botLastRunSnapshot, active_config: cloneBotConfig(botLastRunSnapshot.active_config) }
  });
};
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isPositiveNumber = (value) => Number.isFinite(value) && value > 0;
const asFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const normalizeLadderPrices = (value) => {
  if (!Array.isArray(value) || value.length < 1) return null;
  const nums = value.map((item) => Number(item));
  if (nums.some((item) => !Number.isFinite(item) || item <= 0 || item >= 1)) return null;
  return nums;
};
const normalizeLadderRowsPayload = (value) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized = value.map((item) => {
    const price = asFiniteNumber(item?.price);
    const size = asFiniteNumber(item?.size);
    const tpPriceRaw = item?.tp_price;
    const tpPrice = tpPriceRaw === null || tpPriceRaw === undefined || tpPriceRaw === ''
      ? 1
      : asFiniteNumber(tpPriceRaw);
    if (price === null || price <= 0 || price >= 1) return null;
    if (size === null || size <= 0) return null;
    if (tpPrice === null || tpPrice <= 0 || tpPrice > 1) return null;
    return { price, size, tp_price: tpPrice };
  }).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
};
const hasInvalidLadderRowPayload = (value) => {
  if (!Array.isArray(value) || value.length === 0) return false;
  const normalized = normalizeLadderRowsPayload(value);
  if (!normalized) return true;
  return normalized.length !== value.length;
};
const normalizeCancelPayload = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const beforeEndSec = Number(value.before_end_sec);
  const formula = typeof value.formula === 'string' ? value.formula : '';
  if (!isNonNegativeInteger(beforeEndSec)) return null;
  if (formula.length > 240) return null;
  return { before_end_sec: beforeEndSec, formula };
};
const validateBotConfigPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'invalid payload' };
  const keys = Object.keys(payload);
  const allowedKeys = [
    'open_delay_sec',
    'ladder_prices',
    'ladder_size',
    'atr_multiple',
    'cancel_all_remaining_sec',
    'up_ladder',
    'down_ladder',
    'up_cancel',
    'down_cancel'
  ];
  if (keys.some((key) => !allowedKeys.includes(key))) return { ok: false, error: 'unknown config field' };
  const openDelaySec = Number(payload.open_delay_sec);
  const ladderSize = Number(payload.ladder_size);
  const atrMultiple = Number(payload.atr_multiple);
  const cancelAllRemainingSec = Number(payload.cancel_all_remaining_sec);
  const ladderPrices = normalizeLadderPrices(payload.ladder_prices);
  if (hasInvalidLadderRowPayload(payload.up_ladder) || hasInvalidLadderRowPayload(payload.down_ladder)) {
    return { ok: false, error: 'invalid up_ladder/down_ladder row' };
  }
  const upLadder = normalizeLadderRowsPayload(payload.up_ladder);
  const downLadder = normalizeLadderRowsPayload(payload.down_ladder);
  const upCancel = normalizeCancelPayload(payload.up_cancel);
  const downCancel = normalizeCancelPayload(payload.down_cancel);
  if (!isNonNegativeInteger(openDelaySec)) return { ok: false, error: 'open_delay_sec must be non-negative integer' };
  if (!isPositiveInteger(ladderSize)) return { ok: false, error: 'ladder_size must be positive integer' };
  if (!isPositiveNumber(atrMultiple)) return { ok: false, error: 'atr_multiple must be positive number' };
  if (!isNonNegativeInteger(cancelAllRemainingSec)) return { ok: false, error: 'cancel_all_remaining_sec must be non-negative integer' };
  if (!ladderPrices) return { ok: false, error: 'ladder_prices must be an array of numbers between 0 and 1' };
  const legacyLadder = ladderPrices.map((price) => ({ price, size: ladderSize, tp_price: 1 }));
  const resolvedUpLadder = upLadder || legacyLadder;
  const resolvedDownLadder = downLadder || legacyLadder;
  const resolvedUpCancel = upCancel || { before_end_sec: cancelAllRemainingSec, formula: '' };
  const resolvedDownCancel = downCancel || { before_end_sec: cancelAllRemainingSec, formula: '' };
  if (!resolvedUpLadder || !resolvedDownLadder) return { ok: false, error: 'invalid up_ladder/down_ladder' };
  if (!resolvedUpCancel || !resolvedDownCancel) return { ok: false, error: 'invalid up_cancel/down_cancel' };
  return {
    ok: true,
    value: {
      open_delay_sec: openDelaySec,
      ladder_prices: ladderPrices,
      ladder_size: ladderSize,
      atr_multiple: atrMultiple,
      cancel_all_remaining_sec: cancelAllRemainingSec,
      up_ladder: resolvedUpLadder,
      down_ladder: resolvedDownLadder,
      up_cancel: resolvedUpCancel,
      down_cancel: resolvedDownCancel
    }
  };
};
const coerceRecoveredBotConfig = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return cloneBotConfig(BOT_CONFIG_DEFAULTS);
  const openDelaySec = Number(payload.open_delay_sec);
  const ladderPrices = normalizeLadderPrices(payload.ladder_prices) || [...BOT_CONFIG_DEFAULTS.ladder_prices];
  const ladderSizeRaw = Number(payload.ladder_size);
  const atrMultipleRaw = Number(payload.atr_multiple);
  const cancelAllRemainingSecRaw = Number(payload.cancel_all_remaining_sec);
  const ladderSize = isPositiveInteger(ladderSizeRaw) ? ladderSizeRaw : BOT_CONFIG_DEFAULTS.ladder_size;
  const atrMultiple = isPositiveNumber(atrMultipleRaw) ? atrMultipleRaw : BOT_CONFIG_DEFAULTS.atr_multiple;
  const cancelAllRemainingSec = isNonNegativeInteger(cancelAllRemainingSecRaw)
    ? cancelAllRemainingSecRaw
    : BOT_CONFIG_DEFAULTS.cancel_all_remaining_sec;
  const legacyLadder = ladderPrices.map((price) => ({ price, size: ladderSize, tp_price: 1 }));
  const upLadder = normalizeLadderRowsPayload(payload.up_ladder) || legacyLadder;
  const downLadder = normalizeLadderRowsPayload(payload.down_ladder) || legacyLadder;
  const upCancel = normalizeCancelPayload(payload.up_cancel) || { before_end_sec: cancelAllRemainingSec, formula: '' };
  const downCancel = normalizeCancelPayload(payload.down_cancel) || { before_end_sec: cancelAllRemainingSec, formula: '' };
  return {
    open_delay_sec: isNonNegativeInteger(openDelaySec) ? openDelaySec : BOT_CONFIG_DEFAULTS.open_delay_sec,
    ladder_prices: ladderPrices,
    ladder_size: ladderSize,
    atr_multiple: atrMultiple,
    cancel_all_remaining_sec: cancelAllRemainingSec,
    up_ladder: upLadder,
    down_ladder: downLadder,
    up_cancel: upCancel,
    down_cancel: downCancel
  };
};
const BOT_DEBUG_SCENARIO_MAIN_PATH_V1 = 'main_path_v1';
const BOT_DEBUG_SCENARIO_FILL_YES_PATH_V1 = 'fill_yes_path_v1';
const BOT_DEBUG_SCENARIO_EXIT_YES_PATH_V1 = 'exit_yes_path_v1';
const BOT_DEBUG_SCENARIO_EXIT_NO_PATH_V1 = 'exit_no_path_v1';
const createMainPathV1Frames = () => ([
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 299, btc_price: 100, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 },
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 295, btc_price: 100, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 },
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 290, btc_price: 100, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 },
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 250, btc_price: 103, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 },
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 220, btc_price: 97, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 },
  { window_id: 'debug-main-path-v1-w1', slug: 'debug-main-path-v1-w1', period: '5m', remaining_sec: 100, btc_price: 99, atr_5m: 2, bid_yes: 0.55, ask_yes: 0.56, bid_no: 0.44, ask_no: 0.45 }
]);
const createFillYesPathV1Frames = () => ([
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 299, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 295, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 290, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 280, btc_price: 101, atr_5m: 2, bid_yes: 0.3, ask_yes: 0.27, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 250, btc_price: 103, atr_5m: 2, bid_yes: 0.31, ask_yes: null, bid_no: 0.69, ask_no: null },
  { window_id: 'debug-fill-yes-path-v1-w1', slug: 'debug-fill-yes-path-v1-w1', period: '5m', remaining_sec: 100, btc_price: 102, atr_5m: 2, bid_yes: 0.31, ask_yes: null, bid_no: 0.69, ask_no: null }
]);
const createExitYesPathV1Frames = () => ([
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 299, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 295, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 290, btc_price: 100, atr_5m: 2, bid_yes: 0.3, ask_yes: null, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 280, btc_price: 101, atr_5m: 2, bid_yes: 0.3, ask_yes: 0.27, bid_no: 0.7, ask_no: null },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 250, btc_price: 103, atr_5m: 2, bid_yes: 0.31, ask_yes: null, bid_no: 0.69, ask_no: null },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 180, btc_price: 101, atr_5m: 2, bid_yes: 0.305, ask_yes: null, bid_no: 0.695, ask_no: null, exit_yes_now: true, exit_yes_price: 0.305 },
  { window_id: 'debug-exit-yes-path-v1-w1', slug: 'debug-exit-yes-path-v1-w1', period: '5m', remaining_sec: 100, btc_price: 101, atr_5m: 2, bid_yes: 0.305, ask_yes: null, bid_no: 0.695, ask_no: null }
]);
const createExitNoPathV1Frames = () => ([
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 299, btc_price: 100, atr_5m: 2, bid_yes: 0.7, ask_yes: null, bid_no: 0.3, ask_no: null },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 295, btc_price: 100, atr_5m: 2, bid_yes: 0.7, ask_yes: null, bid_no: 0.3, ask_no: null },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 290, btc_price: 100, atr_5m: 2, bid_yes: 0.7, ask_yes: null, bid_no: 0.3, ask_no: null },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 280, btc_price: 99, atr_5m: 2, bid_yes: 0.7, ask_yes: null, bid_no: 0.3, ask_no: 0.27 },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 250, btc_price: 97, atr_5m: 2, bid_yes: 0.69, ask_yes: null, bid_no: 0.31, ask_no: null },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 180, btc_price: 99, atr_5m: 2, bid_yes: 0.695, ask_yes: null, bid_no: 0.305, ask_no: null, exit_no_now: true, exit_no_price: 0.305 },
  { window_id: 'debug-exit-no-path-v1-w1', slug: 'debug-exit-no-path-v1-w1', period: '5m', remaining_sec: 100, btc_price: 99, atr_5m: 2, bid_yes: 0.695, ask_yes: null, bid_no: 0.305, ask_no: null }
]);
const botLogger = createBotLogger({ maxEntries: 400 });
const botState = createBotStateStore({ mode: BOT_MODE });
const botLedger = createBotOrderLedger({
  onChange: () => {
    if (botRecoveryHydrated) {
      persistBotRecoverySnapshot();
    }
  }
});
const botExecutorPaper = createBotExecutorPaper({ ledger: botLedger });
const botDebugRuntime = {
  name: null,
  frames: [],
  index: 0,
  active: false,
  completed: false
};
const clearBotDebugScenario = () => {
  botDebugRuntime.name = null;
  botDebugRuntime.frames = [];
  botDebugRuntime.index = 0;
  botDebugRuntime.active = false;
  botDebugRuntime.completed = false;
  botState.patchState({ debug_scenario: null, debug_frame_index: 0, debug_completed: false });
};
const enableBotDebugScenario = (name) => {
  if (
    name !== BOT_DEBUG_SCENARIO_MAIN_PATH_V1
    && name !== BOT_DEBUG_SCENARIO_FILL_YES_PATH_V1
    && name !== BOT_DEBUG_SCENARIO_EXIT_YES_PATH_V1
    && name !== BOT_DEBUG_SCENARIO_EXIT_NO_PATH_V1
  ) {
    throw new Error(`unsupported debugScenario: ${name}`);
  }
  const frames = name === BOT_DEBUG_SCENARIO_FILL_YES_PATH_V1
    ? createFillYesPathV1Frames()
    : name === BOT_DEBUG_SCENARIO_EXIT_YES_PATH_V1
      ? createExitYesPathV1Frames()
      : name === BOT_DEBUG_SCENARIO_EXIT_NO_PATH_V1
        ? createExitNoPathV1Frames()
      : createMainPathV1Frames();
  botDebugRuntime.name = name;
  botDebugRuntime.frames = frames;
  botDebugRuntime.index = 0;
  botDebugRuntime.active = true;
  botDebugRuntime.completed = false;
  botState.patchState({ debug_scenario: name, debug_frame_index: 0, debug_completed: false });
  botLogger.log({
    level: 'info',
    source: 'server',
    event: 'BOT_DEBUG_SCENARIO_ENABLED',
    message: `debug scenario enabled: ${name}`,
    mode: BOT_MODE,
    window_id: null,
    data: { frame_total: frames.length }
  });
};
const getDebugScheduledTickParams = () => {
  if (!botDebugRuntime.active) return null;
  const frame = botDebugRuntime.frames[botDebugRuntime.index] || null;
  if (!frame) {
    botDebugRuntime.active = false;
    botDebugRuntime.completed = true;
    botState.patchState({
      debug_scenario: botDebugRuntime.name,
      debug_frame_index: botDebugRuntime.index,
      debug_completed: true
    });
    return {
      params: {},
      stop_after_tick: true,
      stop_reason: 'debug_scenario_frame_exhausted',
      debug_scenario: botDebugRuntime.name,
      frame_index: botDebugRuntime.index
    };
  }
  botDebugRuntime.index += 1;
  const doneAfter = botDebugRuntime.index >= botDebugRuntime.frames.length;
  if (doneAfter) {
    botDebugRuntime.active = false;
    botDebugRuntime.completed = true;
  }
  botState.patchState({
    debug_scenario: botDebugRuntime.name,
    debug_frame_index: botDebugRuntime.index,
    debug_completed: doneAfter
  });
  botLogger.log({
    level: 'info',
    source: 'server',
    event: 'BOT_DEBUG_FRAME',
    message: `debug frame ${botDebugRuntime.index}/${botDebugRuntime.frames.length}`,
    mode: BOT_MODE,
    window_id: frame.window_id ?? null,
    data: {
      debug_scenario: botDebugRuntime.name,
      frame_index: botDebugRuntime.index,
      remaining_sec: frame.remaining_sec ?? null,
      btc_price: frame.btc_price ?? null
    }
  });
  return {
    params: { context_override: frame },
    stop_after_tick: doneAfter,
    stop_reason: doneAfter ? 'debug_scenario_completed' : null,
    debug_scenario: botDebugRuntime.name,
    frame_index: botDebugRuntime.index
  };
};
const botRunner = createBotRunner({
  getContext: () => botContextAdapter.getContext(),
  getState: () => botState.getState(),
  patchState: (patch) => botState.patchState(patch),
  createWindowResetPatch: (nextWindowId) => botState.createWindowResetPatch(nextWindowId),
  createWindowInitPatch: (params) => botState.createWindowInitPatch(params),
  decide: (input) => decideBotAction(input),
  applyIntents: (intents, params) => botExecutorPaper.applyIntents(intents, params),
  applyFills: (context) => botExecutorPaper.applyFills(context),
  getOrders: () => botExecutorPaper.getOrders(),
  getSummary: () => botExecutorPaper.getSummary(),
  getScheduledTickParams: () => getDebugScheduledTickParams(),
  onRuntimeUpdate: (runtime) => {
    botState.patchState(runtime);
    const isRunning = runtime?.running === true;
    if (botRuntimeWasRunning && !isRunning) {
      const stateAtStop = botState.getState();
      const completedWindowId = stateAtStop?.current_window_id ?? null;
      const stopReason = botPendingStopReason || 'AUTO_COMPLETED';
      finalizeBotRunSnapshot(stopReason);
      botPendingStopReason = null;
      botActiveRuntimeConfig = cloneBotConfig(getBotConfigSnapshot());
      botLastTickResult = null;
      botState.patchState({
        current_window_id: null,
        last_window_id: completedWindowId ?? stateAtStop?.last_window_id ?? null,
        window_initialized_at: null,
        anchor_btc: null,
        atr_5m: null,
        upper_bound: null,
        lower_bound: null,
        phase: 'IDLE',
        last_reason: null,
        last_intents: []
      });
    }
    botRuntimeWasRunning = isRunning;
    if (botRecoveryHydrated) {
      persistBotRecoverySnapshot();
    }
  },
  onTickResult: (result) => {
    botLastTickResult = result ? {
      decision_preview: result.decision_preview || null,
      context_snapshot: result.context_snapshot || null,
      state_before: result.state_before || null,
      state_after: result.state_after || null,
      order_summary: result.order_summary || null
    } : null;
    if (botRecoveryHydrated) {
      persistBotRecoverySnapshot();
    }
  },
  log: (entry) => {
    if (entry?.event === 'BOT_INTENTS') {
      registerBotRunAction(entry?.message);
    }
    botLogger.log(entry);
  },
  getLogCount: () => botLogger.getCount(),
  config: botRunnerConfig
});

// 加载策略配置
function loadConfig(strategyId) {
  const configPath = resolve(__dirname, 'instances', `${strategyId}.json`);
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

logger.info(EVENTS.SERVER_START, {
  module: 'server',
  log_level: process.env.LOG_LEVEL || 'info',
  port: PORT,
  strategy: STRATEGY_ID || 'none',
});
botLogger.log({
  level: 'info',
  source: 'server',
  event: 'BOT_LOGGER_READY',
  message: 'bot logger initialized',
  mode: BOT_MODE,
  window_id: null,
  data: { port: PORT, strategy: STRATEGY_ID || 'none' }
});
botState.patchState({
  mode: BOT_MODE,
  phase: 'IDLE',
  running: false,
  tick_interval_ms: BOT_TICK_INTERVAL_DEFAULT_MS,
  last_tick_at: null
});

function syncBotStateFromLedger() {
  const state = botState.getState();
  const currentWindowId = state?.current_window_id ?? null;
  const orders = botExecutorPaper.getOrders();
  const scopedOpenOrders = orders.filter((o) => (
    o.status === 'OPEN'
    && currentWindowId
    && o.window_id === currentWindowId
  ));
  const openYes = scopedOpenOrders.filter(o => o.side === 'YES').map(o => o.order_id);
  const openNo = scopedOpenOrders.filter(o => o.side === 'NO').map(o => o.order_id);
  botState.patchState({
    yes_order_ids: openYes,
    no_order_ids: openNo,
    ladder_posted: openYes.length > 0 || openNo.length > 0
  });
}

function persistBotRecoverySnapshot() {
  try {
    const payload = {
      saved_config: getBotConfigSnapshot(),
      active_runtime_config: getBotActiveRuntimeConfig(),
      state: botState.getState(),
      orders: botExecutorPaper.getOrders(),
      last_run_snapshot: getBotLastRunSnapshot(),
      saved_at: new Date().toISOString()
    };
    mkdirSync(dirname(BOT_RUNTIME_RECOVERY_PATH), { recursive: true });
    const tempPath = `${BOT_RUNTIME_RECOVERY_PATH}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    if (existsSync(BOT_RUNTIME_RECOVERY_PATH)) {
      unlinkSync(BOT_RUNTIME_RECOVERY_PATH);
    }
    renameSync(tempPath, BOT_RUNTIME_RECOVERY_PATH);
  } catch (err) {
    botLogger.log({
      level: 'error',
      source: 'server',
      event: 'BOT_RECOVERY_PERSIST_FAILED',
      message: err.message,
      mode: BOT_MODE,
      window_id: null
    });
  }
}
function restoreBotRecoverySnapshot() {
  const snapshot = readJsonSafe(BOT_RUNTIME_RECOVERY_PATH);
  if (!snapshot || typeof snapshot !== 'object') return false;
  try {
    botLogger.log({
      level: 'info',
      source: 'server',
      event: 'BOT_RECOVERY_RESTORE_INPUT',
      message: 'recovery snapshot input loaded',
      mode: BOT_MODE,
      window_id: null,
      data: {
        path: BOT_RUNTIME_RECOVERY_PATH,
        saved_open_delay_sec: snapshot?.saved_config?.open_delay_sec ?? null
      }
    });
    const savedCfgRaw = snapshot.saved_config;
    const recoveredConfig = coerceRecoveredBotConfig(savedCfgRaw);
    setBotConfigCurrent(recoveredConfig, { persist: false });
    if (Array.isArray(snapshot.orders)) {
      botLedger.restore(snapshot.orders);
      syncBotStateFromLedger();
    }
    if (snapshot.last_run_snapshot && typeof snapshot.last_run_snapshot === 'object') {
      botLastRunSnapshot = snapshot.last_run_snapshot;
    }
    const recoveredState = snapshot.state && typeof snapshot.state === 'object' ? snapshot.state : null;
    if (recoveredState) {
      botState.patchState({
        ...recoveredState,
        running: false,
        debug_scenario: null,
        debug_frame_index: 0,
        debug_completed: false,
        phase: recoveredState.phase || 'IDLE'
      });
    }
    botActiveRuntimeConfig = cloneBotConfig(recoveredConfig);
    botRuntimeWasRunning = false;
    persistBotRecoverySnapshot();
    botLogger.log({
      level: 'info',
      source: 'server',
      event: 'BOT_RECOVERY_RESTORED',
      message: 'recovery snapshot restored',
      mode: BOT_MODE,
      window_id: null,
      data: {
        saved_open_delay_sec: getBotConfigSnapshot()?.open_delay_sec ?? null,
        active_open_delay_sec: getBotActiveRuntimeConfig()?.open_delay_sec ?? null
      }
    });
    return true;
  } catch (err) {
    botLogger.log({
      level: 'error',
      source: 'server',
      event: 'BOT_RECOVERY_RESTORE_FAILED',
      message: err.message,
      mode: BOT_MODE,
      window_id: null
    });
    return false;
  }
}
function ensureBotRecoveryHydrated() {
  if (botRecoveryHydrated) return;
  restoreBotRecoverySnapshot();
  botRecoveryHydrated = true;
}

const toEpochMs = (value) => {
  const ts = Date.parse(value || '');
  return Number.isNaN(ts) ? null : ts;
};

const buildWindowRangesFromLogs = (logs = []) => {
  const markers = logs
    .filter((entry) => (
      (entry?.event === 'BOT_WINDOW_CHANGED' || entry?.event === 'BOT_WINDOW_INITIALIZED')
      && typeof entry?.window_id === 'string'
      && entry.window_id.length > 0
    ))
    .map((entry) => ({
      window_id: entry.window_id,
      ts_ms: toEpochMs(entry.ts)
    }))
    .filter((entry) => entry.ts_ms != null)
    .sort((a, b) => a.ts_ms - b.ts_ms);
  if (!markers.length) return [];
  const starts = [];
  for (const marker of markers) {
    const last = starts.length ? starts[starts.length - 1] : null;
    if (!last || last.window_id !== marker.window_id) {
      starts.push(marker);
    }
  }
  return starts.map((start, index) => ({
    window_id: start.window_id,
    start_ts_ms: start.ts_ms,
    end_ts_ms: starts[index + 1]?.ts_ms ?? null
  }));
};

const inferWindowIdForOrder = (order, ranges = []) => {
  const createdTs = toEpochMs(order?.created_at);
  if (createdTs == null || !ranges.length) return null;
  for (const range of ranges) {
    if (createdTs >= range.start_ts_ms && (range.end_ts_ms == null || createdTs < range.end_ts_ms)) {
      return range.window_id;
    }
  }
  return null;
};
const buildBotOrdersWithWindowIds = () => {
  const allOrdersRaw = botExecutorPaper.getOrders();
  const logs = botLogger.getRecentLogs(500);
  const ranges = buildWindowRangesFromLogs(logs);
  const allOrders = Array.isArray(allOrdersRaw)
    ? allOrdersRaw.map((order) => ({
        ...order,
        inferred_window_id: inferWindowIdForOrder(order, ranges),
        resolved_window_id: (typeof order?.window_id === 'string' && order.window_id.length > 0)
          ? order.window_id
          : inferWindowIdForOrder(order, ranges)
      }))
    : [];
  return { allOrders };
};
const resolveBotWindowScope = (state = {}) => {
  const running = state?.running === true;
  const activeWindowId = state?.current_window_id ?? null;
  const lastRunWindowId = getBotLastRunSnapshot()?.current_window_id ?? state?.last_window_id ?? null;
  const displayWindowId = running ? activeWindowId : (lastRunWindowId ?? null);
  const scope = running ? 'current_window' : (displayWindowId ? 'last_window' : 'none');
  return { running, activeWindowId, displayWindowId, scope };
};
const selectWindowOrdersForDisplay = (allOrders = [], options = {}) => {
  const displayWindowId = options?.displayWindowId ?? null;
  const running = options?.running === true;
  const windowInitializedAt = options?.windowInitializedAt ?? null;
  let windowOrders = [];
  if (displayWindowId) {
    windowOrders = allOrders.filter((order) => order.resolved_window_id === displayWindowId);
  }
  if (displayWindowId && windowOrders.length === 0 && windowInitializedAt) {
    const initTs = toEpochMs(windowInitializedAt);
    if (initTs != null) {
      windowOrders = allOrders.filter((order) => {
        const createdTs = toEpochMs(order.created_at);
        return createdTs != null
          && createdTs >= initTs
          && (order.resolved_window_id == null || order.resolved_window_id === displayWindowId);
      });
    }
  }
  if (displayWindowId) {
    windowOrders = windowOrders.filter((order) => (
      order.resolved_window_id == null || order.resolved_window_id === displayWindowId
    ));
  }
  const hiddenOtherWindowCount = displayWindowId
    ? Math.max(0, allOrders.length - windowOrders.length)
    : 0;
  windowOrders.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const scope = running ? 'current_window' : (displayWindowId ? 'last_window' : 'none');
  return { windowOrders, hiddenOtherWindowCount, scope };
};
const countUniqueFilledOrderIds = (orders = []) => {
  const ids = new Set(
    orders
      .filter((order) => order?.status === 'FILLED')
      .map((order) => order?.order_id)
      .filter((orderId) => typeof orderId === 'string' && orderId.length > 0)
  );
  return ids.size;
};
const getScopedFilledTotalForState = (state = {}, preferredWindowId = null) => {
  const { allOrders } = buildBotOrdersWithWindowIds();
  const scope = resolveBotWindowScope(state);
  const displayWindowId = preferredWindowId || scope.displayWindowId;
  if (!displayWindowId) return 0;
  const strictWindowOrders = allOrders.filter((order) => order.resolved_window_id === displayWindowId);
  return countUniqueFilledOrderIds(strictWindowOrders);
};
const getBotPaperSummaryScoped = (context = null) => {
  const baseSummary = context == null
    ? botExecutorPaper.getPaperSummary()
    : botExecutorPaper.getPaperSummary(context);
  const state = botState.getState();
  const filledTotal = getScopedFilledTotalForState(state);
  return {
    ...baseSummary,
    filled_total: filledTotal
  };
};

// 供 strategy_runner_se.mjs 动态导入使用
export function getGlobalSnapshot() {
  return _globalOrderbookMonitor?.getLatestSnapshot?.() || null;
}
export function getGlobalRegime() {
  return getActiveRunner()?.getRegimeState?.() || null;
}

// 全局盘口监控（不依赖 runner，服务启动即开始）
let _globalOrderbookMonitor = null;
let _globalScanner          = null;
const botContextAdapter = createBotContextAdapter({
  getScanner: () => _globalScanner,
  getOrderbookMonitor: () => _globalOrderbookMonitor,
  getState: () => botState.getState()
});

async function initGlobalOrderbook() {
  try {
    const baseConfig = {
      market: { slug_prefix: 'btc-updown-5m-', window_minutes: 5 },
      polymarket_poll_sec: 2,
      polymarket_mode: 'rest',
    };
    _globalScanner = createScanner(baseConfig);
    global._btcqddGlobalScanner = _globalScanner;
    const win = await _globalScanner.findCurrentWindow();
    if (!win || !win.up_token_id) {
      console.warn('[server] initGlobalOrderbook: no active BTC 5m window found');
      return;
    }
    console.info(`[server] initGlobalOrderbook: window ${win.slug}, up=${win.up_token_id.slice(0,8)}…`);

    // 停止旧的 monitor（防止旧实例继续用过期 token_id 发请求）
    if (_globalOrderbookMonitor) {
      try { _globalOrderbookMonitor.stop(); } catch(_) {}
      _globalOrderbookMonitor = null;
    }

    _globalOrderbookMonitor = createOrderbookMonitor(baseConfig);
    _globalOrderbookMonitor.start(win.up_token_id, win.down_token_id);
    console.info('[server] Global orderbook monitor started');

    // 注入全局快照获取函数，供 strategy_runner_se.mjs 调用
    global._btcqddGetSnapshot = () => _globalOrderbookMonitor?.getLatestSnapshot?.() || null;
    global._btcqddGlobalOrderbook = _globalOrderbookMonitor;
  } catch (err) {
    console.warn('[server] initGlobalOrderbook failed:', err.message);
    // 失败不阻塞服务启动
  }
}

// 监听窗口切换，用新窗口 token_id 重新初始化盘口
subscribe(async (evt) => {
  if (evt.type !== EVENT_TYPES.WINDOW_SWITCH) return;
  
  if (!fs.existsSync('data/crypto_binary/logs')) {
    fs.mkdirSync('data/crypto_binary/logs', { recursive: true });
  }
  const ts = new Date().toISOString();
  fs.appendFileSync('data/crypto_binary/logs/window_switch.log', `${ts} WINDOW_SWITCH received\n`);

  // 先同步保存旧窗口 token_ids（必须在 initGlobalOrderbook 之前）
  if (_globalOrderbookMonitor) {
    global._btcqddLastWindowTokenIds = _globalOrderbookMonitor.getTokenIds?.() || null;
  }

  console.info('[server] WINDOW_SWITCH detected, reinitializing orderbook...');
  await initGlobalOrderbook();

  fs.appendFileSync('data/crypto_binary/logs/window_switch.log', `${ts} initGlobalOrderbook done\n`);
});

let db = null;
(async () => {
  db = await getDb();
  await initPostmortem();
  await ensureBotPostmortemColumns();
  await initManualTrade(db);
  console.log('[BTCQDD] DB migration completed (initPostmortem + initManualTrade)');

  // 服务启动后异步初始化全局盘口（不阻塞 listen）
  initGlobalOrderbook();

  if (STRATEGY_ID) {
    const result = await startInstance(STRATEGY_ID);
    if (result.ok) {
      logger.info({ module: 'server', strategy: STRATEGY_ID, msg: 'auto-started from --strategy arg' });
    } else {
      logger.error({ module: 'server', strategy: STRATEGY_ID, err: result.error, msg: 'auto-start failed' });
    }
  }

  // 定时轮询检测 regime/window 状态变化 → publish 事件（替代方案，2s 延迟）
  // 所有内部事件发射点均在 scope 外模块，无法直接注入 publish，故采用轮询
  let _lastRegimeScore = null;
  let _lastWindowId = null;
  setInterval(async () => {
    try {
      const activeRunner = getActiveRunner();
      const regimeState = activeRunner ? activeRunner.getRegimeState() : null;
      if (regimeState) {
        const score = regimeState.regime_score ?? null;
        if (_lastRegimeScore !== null && score !== null && Math.abs(score - _lastRegimeScore) > 0.05) {
          publish(EVENT_TYPES.REGIME_CHANGED, { regime_score: score, prev: _lastRegimeScore });
        }
        _lastRegimeScore = score;
      }

      // 用 scanner 直接检测窗口切换（不依赖策略运行器）
      if (_globalScanner) {
        try {
          const win = await _globalScanner.findCurrentWindow();
          const windowId = win?.slug ?? null;
          if (windowId && _lastWindowId !== null && windowId !== _lastWindowId) {
            publish(EVENT_TYPES.WINDOW_SWITCH, { window_id: windowId, prev: _lastWindowId });
          }
          if (windowId) _lastWindowId = windowId;
        } catch (_) {}
      }
    } catch (_) { /* runner not yet ready */ }
  }, 2000);
})().catch(err => {
  logger.error(EVENTS.ERROR_UNHANDLED_PATH, { module: 'server', err: err.message, msg: 'runner failed to start' });
});

// 深度嵌套合并：将 "a.b.c" 形式的扁平键写入嵌套对象
function applyNestedOverrides(target, overrides) {
  const result = JSON.parse(JSON.stringify(target));
  for (const [key, value] of Object.entries(overrides)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let obj = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
          obj[parts[i]] = {};
        }
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function deepMerge(base, patch) {
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])
        && base[key] && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key], patch[key]);
    } else {
      result[key] = patch[key];
    }
  }
  return result;
}

const server = createServer(async (req, res) => {
  // CORS headers for local UI (file:// → localhost)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET / — 健康检查
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      port: PORT,
      strategy: STRATEGY_ID || 'none',
      runner_active: getActiveRunner() !== null
    }));
    return;
  }

  // POST /config/reload — 热更新
  if (req.method === 'POST' && req.url === '/config/reload') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed.name) {
          // 新路径：指定实例 reload
          const result = await reloadInstance(parsed.name);
          sendJson(res, result, result.ok ? 200 : 500);
          return;
        }
        // 旧路径：全局 reload（向后兼容，STRATEGY_ID 必须存在）
        if (!STRATEGY_ID) {
          sendJson(res, { ok: false, error: 'no strategy loaded, use { name } to specify instance' }, 400);
          return;
        }
        const result = await reloadInstance(STRATEGY_ID);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ── UI 专用端点（B1 控制面板）──────────────────────────

  // GET /ui/regime — 当前市场状态评分
  if (req.method === 'GET' && req.url === '/ui/regime') {
    try {
      const ar = getActiveRunner();
      const state = ar ? ar.getRegimeState() : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: state }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/instances — 扫描磁盘 instances 目录，合并运行时状态
  if (req.method === 'GET' && req.url === '/ui/instances') {
    try {
      sendJson(res, { instances: smGetStatus() });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /ui/cancel-stats — 撤单引擎统计
  if (req.method === 'GET' && req.url === '/ui/cancel-stats') {
    try {
      const ar = getActiveRunner();
      const stats = ar ? ar.getCancelStats() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: stats }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /ui/active-orders — 当前活跃挂单
  if (req.method === 'GET' && req.url === '/ui/active-orders') {
    try {
      const ar = getActiveRunner();
      const orders = ar ? ar.getActiveOrders() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: orders }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /book/snapshot — 订单簿快照
  if (req.method === 'GET' && req.url === '/book/snapshot') {
    try {
      const ar = getActiveRunner();
      const monitor = _globalOrderbookMonitor
        || (ar ? { getLatestSnapshot: () => ar.getOrderbookSnapshot() } : null);
      const snap = monitor ? monitor.getLatestSnapshot() : null;
      sendJson(res, {
        bids: snap ? [] : [],
        asks: snap ? [] : [],
        best_bid: snap?.bid_up ?? null,
        best_ask: snap?.ask_up ?? null,
        mid: snap?.mid_up ?? null,
        spread: snap?.spread_up ?? null,
        tick_size: snap?.tick_size ?? null,
        updated_at: snap?.sampled_at ?? Date.now()
      });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // GET /trading/orders — 订单列表（来自 trading_orders 表）
  if (req.method === 'GET' && req.url === '/trading/orders') {
    try {
      if (!db) { sendJson(res, [], 200); return; }
      const orders = await db.all('SELECT * FROM trading_orders ORDER BY created_at DESC LIMIT 200');
      sendJson(res, orders ?? []);
    } catch {
      sendJson(res, []);
    }
    return;
  }

  // POST /trading/manual — 手动下单
  if (req.method === 'POST' && req.url === '/trading/manual') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body || '{}');
        if (!db) throw new Error('db not ready');
        const result = await submitManualOrder(params, { db });
        sendJson(res, result);
      } catch (e) {
        const status = e.message.startsWith('missing required') ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /trading/manual-stats — 手动交易统计
  if (req.method === 'GET' && req.url === '/trading/manual-stats') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const stats = await getManualStats(db);
      sendJson(res, stats);
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // GET /trading/manual/stats — 带重置过滤的手动交易统计
  if (req.method === 'GET' && req.url === '/trading/manual/stats') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const resetAt = global._manualTradeResetAt || 0;
      const row = await db.get(
        `SELECT
          COUNT(*) as total_trades,
          COALESCE(SUM(CASE WHEN status='filled' THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END), 0) as losses,
          COALESCE(SUM(CASE WHEN status='filled' THEN COALESCE(pnl,0) ELSE 0 END), 0) as total_pnl
        FROM trading_orders
        WHERE source='manual' AND created_at > ?`,
        [resetAt]
      );
      const r = row || { total_trades: 0, wins: 0, losses: 0, total_pnl: 0 };
      const win_rate = r.total_trades > 0 ? (r.wins || 0) / r.total_trades : 0;
      sendJson(res, { total_trades: r.total_trades || 0, wins: r.wins || 0, losses: r.losses || 0, total_pnl: r.total_pnl || 0, win_rate });
    } catch (e) {
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  // POST /trading/manual/reset — 软重置手动交易统计
  if (req.method === 'POST' && req.url === '/trading/manual/reset') {
    global._manualTradeResetAt = Date.now();
    sendJson(res, { ok: true, reset_at: new Date(global._manualTradeResetAt).toISOString() });
    return;
  }

  // GET /klines — 转发 Binance REST klines（K 线代理）
  if (req.method === 'GET' && req.url.startsWith('/klines')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const symbol   = params.get('symbol')   || 'BTCUSDT';
    const interval = params.get('interval') || '15m';
    const limit    = parseInt(params.get('limit') || '21', 10);
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
      const resp = await _proxyFetch(url);
      if (!resp.ok) {
        sendJson(res, { ok: false, error: `Binance ${resp.status}` }, 502);
        return;
      }
      const data = await resp.json();
      sendJson(res, { ok: true, klines: data });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // ── 复盘分析端点（UI-M4）──────────────────────────────────

  // GET /postmortem/attribution
  if (req.method === 'GET' && req.url.startsWith('/postmortem/attribution')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _attrUrl = new URL(req.url, 'http://localhost');
      const _attrSid = _attrUrl.searchParams.get('strategy_id') || null;
      if (!_attrSid) {
        sendJson(res, await getAttribution(db));
      } else {
        const regimeBuckets = await db.all(`
          SELECT
            CASE
              WHEN regime_score >= 0.6 THEN 'oscillating'
              WHEN regime_score >= 0.4 THEN 'transitional'
              ELSE 'trending'
            END as regime_bucket,
            COUNT(*) as count,
            COALESCE(SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0
              THEN 1.0 - pair_cost ELSE 0 END), 0) as total_pnl,
            AVG(pair_cost) as avg_cost
          FROM cb_postmortem
          WHERE regime_score IS NOT NULL AND strategy_id = ?
          GROUP BY regime_bucket
          ORDER BY regime_bucket
        `, [_attrSid]);
        const hourBuckets = await db.all(`
          SELECT
            CASE
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 1  AND 7  THEN 'asia'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 7  AND 12 THEN 'europe'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 12 AND 16 THEN 'us_morning'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 16 AND 20 THEN 'us_afternoon'
              WHEN CAST(strftime('%H', window_start) AS INTEGER) BETWEEN 20 AND 23 THEN 'us_close'
              ELSE 'overnight'
            END as hour_bucket,
            COUNT(*) as count,
            COALESCE(SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0
              THEN 1.0 - pair_cost ELSE 0 END), 0) as total_pnl
          FROM cb_postmortem
          WHERE window_start IS NOT NULL AND strategy_id = ?
          GROUP BY hour_bucket
          ORDER BY hour_bucket
        `, [_attrSid]);
        sendJson(res, { regime_buckets: regimeBuckets, hour_buckets: hourBuckets });
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/loss-modes
  if (req.method === 'GET' && req.url.startsWith('/postmortem/loss-modes')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _lmUrl = new URL(req.url, 'http://localhost');
      const _lmSid = _lmUrl.searchParams.get('strategy_id') || null;
      if (!_lmSid) {
        sendJson(res, await getLossModes(db));
      } else {
        const modes = await db.all(`
          SELECT
            CASE
              WHEN pair_cost IS NULL        THEN 'unpaired_timeout'
              WHEN pair_cost >= 1.05        THEN 'wrong_direction'
              WHEN pair_cost >= 1.0         THEN 'spread_eaten'
              ELSE                          'other'
            END as loss_mode,
            COUNT(*) as count,
            AVG(pair_cost) as avg_cost,
            MIN(pair_cost) as worst_cost
          FROM cb_postmortem
          WHERE (pair_cost IS NULL OR pair_cost >= 1.0) AND strategy_id = ?
          GROUP BY loss_mode
          ORDER BY count DESC
        `, [_lmSid]);
        const examples = {};
        for (const mode of modes) {
          const ex = await db.get(`
            SELECT id, strategy_id, window_start, window_end, pair_cost, regime_score
            FROM cb_postmortem
            WHERE (
              CASE
                WHEN pair_cost IS NULL        THEN 'unpaired_timeout'
                WHEN pair_cost >= 1.05        THEN 'wrong_direction'
                WHEN pair_cost >= 1.0         THEN 'spread_eaten'
                ELSE                          'other'
              END
            ) = ? AND strategy_id = ?
            ORDER BY id DESC LIMIT 1
          `, [mode.loss_mode, _lmSid]);
          if (ex) examples[mode.loss_mode] = ex;
        }
        sendJson(res, { modes, examples });
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/sensitivity
  if (req.method === 'GET' && req.url.startsWith('/postmortem/sensitivity')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const _sensUrl = new URL(req.url, 'http://localhost');
      const _sensSid = _sensUrl.searchParams.get('strategy_id') || null;
      if (!_sensSid) {
        sendJson(res, await getSensitivity(db));
      } else {
        const rows = await db.all(`
          SELECT
            config_hash,
            strategy_id,
            COUNT(*) as total_windows,
            SUM(CASE WHEN pair_cost IS NOT NULL AND pair_cost < 1.0 THEN 1 ELSE 0 END) as wins,
            AVG(pair_cost) as avg_cost,
            AVG(regime_score) as avg_regime,
            MIN(created_at) as first_trade,
            MAX(created_at) as last_trade
          FROM cb_postmortem
          WHERE config_hash IS NOT NULL AND strategy_id = ?
          GROUP BY config_hash, strategy_id
          ORDER BY avg_cost ASC
        `, [_sensSid]);
        sendJson(res, rows);
      }
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/distribution
  if (req.method === 'GET' && req.url === '/postmortem/distribution') {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getDistribution(db));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // GET /postmortem/compare?ids=s1,s2
  if (req.method === 'GET' && req.url.startsWith('/postmortem/compare')) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const ids = (parsedUrl.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    if (ids.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ids query param required' }));
      return;
    }
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      sendJson(res, await getCompare(db, ids));
    } catch (e) { sendJson(res, { error: e.message }, 500); }
    return;
  }

  // ─── POST /strategies/create ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/strategies/create') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, base_config, overrides = {} } = JSON.parse(body || '{}');

        // 参数校验
        if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
          sendJson(res, { ok: false, error: 'name 只允许字母/数字/下划线/连字符，长度 1~64' }, 400);
          return;
        }

        const instancesDir = resolve(__dirname, 'instances');
        const filePath = resolve(instancesDir, `${name}.json`);

        // 防止覆盖已有实例
        if (existsSync(filePath)) {
          sendJson(res, { ok: false, error: `实例 ${name} 已存在` }, 409);
          return;
        }

        // 读取模板（base_config 为已有实例名），不指定则空对象
        let template = {};
        if (base_config) {
          const tplPath = resolve(instancesDir, `${base_config}.json`);
          if (existsSync(tplPath)) {
            template = JSON.parse(readFileSync(tplPath, 'utf8'));
          }
        }

        // 合并参数（支持 "a.b.c" 嵌套键），strategy_id 必须等于实例名
        const newConfig = applyNestedOverrides(template, overrides);
        newConfig.strategy_id = name;

        // 校验必填字段
        if (!newConfig.strategy_id) {
          sendJson(res, { ok: false, error: 'strategy_id is required' }, 400);
          return;
        }
        if (!newConfig.strategy?.type) {
          sendJson(res, { ok: false, error: 'strategy.type is required' }, 400);
          return;
        }

        // 写入文件
        mkdirSync(instancesDir, { recursive: true });
        writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf8');

        // 触发热加载（忽略失败，文件已写入即成功）
        fetch(`http://localhost:${PORT}/config/reload`, { method: 'POST' }).catch(() => {});

        sendJson(res, { ok: true, name, file: `instances/${name}.json` });
      } catch (e) {
        sendJson(res, { ok: false, error: e.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/start — 启动指定实例
  if (req.method === 'POST' && req.url === '/strategies/start') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await startInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/stop — 停止指定实例
  if (req.method === 'POST' && req.url === '/strategies/stop') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await stopInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // POST /strategies/reload — 重载指定实例
  if (req.method === 'POST' && req.url.startsWith('/strategies/reload')) {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body || '{}');
        if (!name) { sendJson(res, { ok: false, error: 'name required' }, 400); return; }
        const result = await reloadInstance(name);
        sendJson(res, result, result.ok ? 200 : 500);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ─── DELETE /strategies/:name ──────────────────────────────────────────────
  if (req.method === 'DELETE' && /^\/strategies\/[a-zA-Z0-9_-]{1,64}$/.test(req.url)) {
    const name = req.url.slice('/strategies/'.length);
    try {
      const filePath = resolve(__dirname, 'instances', `${name}.json`);
      if (!existsSync(filePath)) {
        sendJson(res, { ok: false, error: `实例 ${name} 不存在` }, 404);
        return;
      }

      unlinkSync(filePath);
      fetch(`http://localhost:${PORT}/config/reload`, { method: 'POST' }).catch(() => {});

      // git rm + commit：彻底从版本历史移除，防止 checkout/restore 复活
      const repoRoot = resolve(__dirname, '..', '..');
      const gitRelPath = `strategies/crypto_binary/instances/${name}.json`;
      try {
        execSync(`git rm --cached --force "${gitRelPath}"`, { cwd: repoRoot, stdio: 'pipe' });
        execSync(`git commit -m "remove instance: ${name}"`, { cwd: repoRoot, stdio: 'pipe' });
        console.info(`[server] instance ${name} removed from git`);
      } catch (gitErr) {
        console.warn(`[server] git rm/commit failed for ${name}:`, gitErr.message);
      }

      sendJson(res, { ok: true, name, deleted: true });
    } catch (e) {
      sendJson(res, { ok: false, error: e.message }, 500);
    }
    return;
  }

  // ─── GET /strategies/:name/config ──────────────────────────────────────────
  {
    const { pathname: pn } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pn.startsWith('/strategies/') && pn.endsWith('/config')) {
      const name = pn.split('/')[2];
      const instancePath = resolve(__dirname, 'instances', `${name}.json`);

      if (!existsSync(instancePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Instance not found: ${name}` }));
        return;
      }

      try {
        const cfg = JSON.parse(readFileSync(instancePath, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // ─── PUT /strategies/:name/config ───────────────────────────────────────────
  {
    const { pathname: pn } = new URL(req.url, 'http://localhost');
    if (req.method === 'PUT' && pn.startsWith('/strategies/') && pn.endsWith('/config')) {
      const name = pn.split('/')[2];
      const instancePath = resolve(__dirname, 'instances', `${name}.json`);

      if (!existsSync(instancePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Instance not found: ${name}` }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const patch = JSON.parse(body);

          // 参数范围校验
          if (patch.strategy) {
            const s = patch.strategy;
            if (s.entry_offset !== undefined && (s.entry_offset < 0.001 || s.entry_offset > 0.2)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'entry_offset must be between 0.001 and 0.2' }));
              return;
            }
            if (s.order_tranches !== undefined && (s.order_tranches < 1 || s.order_tranches > 5)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'order_tranches must be between 1 and 5' }));
              return;
            }
          }

          // 读取现有配置，深度合并 patch
          const existing = JSON.parse(readFileSync(instancePath, 'utf8'));
          const merged = deepMerge(existing, patch);
          writeFileSync(instancePath, JSON.stringify(merged, null, 2), 'utf8');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, written: instancePath, name }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // ─── GET /strategies/status ────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/strategies/status') {
    sendJson(res, { instances: smGetStatus() });
    return;
  }

  // ─── GET /stats — postmortem 聚合统计，支持 group_by 参数 ─────────────────
  if (req.method === 'GET' && req.url.startsWith('/stats')) {
    try {
      if (!db) { sendJson(res, { error: 'db not ready' }, 503); return; }
      const parsedUrl = new URL(req.url, 'http://localhost');
      const groupByParam = parsedUrl.searchParams.get('group_by') || 'strategy_id';
      const ALLOWED = ['strategy_id', 'config_hash', 'symbol', 'timeframe', 'strategy_type'];
      const groupKeys = groupByParam.split(',').map(k => k.trim()).filter(k => ALLOWED.includes(k));
      if (groupKeys.length === 0) {
        sendJson(res, { error: 'Invalid group_by fields' }, 400);
        return;
      }
      const selectCols = groupKeys.join(', ');
      const rows = await db.all(`
        SELECT
          ${selectCols},
          COUNT(*) AS count,
          AVG(paper_pnl) AS avg_pnl,
          AVG(CASE WHEN paper_pnl > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
          AVG(pair_cost) AS avg_pair_cost,
          AVG(regime_score) AS avg_regime_score,
          MIN(created_at) AS first_at,
          MAX(created_at) AS last_at
        FROM cb_postmortem
        GROUP BY ${selectCols}
        ORDER BY count DESC
      `);
      sendJson(res, { rows: rows ?? [], total_count: (rows ?? []).reduce((s, r) => s + r.count, 0) });
    } catch (err) {
      console.error('[Stats] Error:', err.message);
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // ── /strategy-runner/* ────────────────────────────────────────────────

  // POST /strategy-runner/deploy
  if (req.method === 'POST' && req.url === '/strategy-runner/deploy') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const { code, period } = JSON.parse(body || '{}');
        if (!code) { sendJson(res, { ok: false, error: 'code required' }, 400); return; }
        const result = await strategyRunnerSe.deploy(code, period);
        sendJson(res, result);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 400);
      }
    });
    return;
  }

  // POST /strategy-runner/stop
  if (req.method === 'POST' && req.url === '/strategy-runner/stop') {
    try {
      strategyRunnerSe.stop();
      sendJson(res, { ok: true });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /strategy-runner/code — 读取用户保存的策略代码
  if (req.method === 'GET' && req.url === '/strategy-runner/code') {
    try {
      const codePath = resolve(__dirname, 'instances', 'se_custom_code.js');
      if (fs.existsSync(codePath)) {
        const code = fs.readFileSync(codePath, 'utf-8');
        sendJson(res, { ok: true, code });
      } else {
        sendJson(res, { ok: true, code: null });
      }
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // POST /strategy-runner/code — 保存用户策略代码到服务端文件
  if (req.method === 'POST' && req.url === '/strategy-runner/code') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        if (typeof code !== 'string') {
          sendJson(res, { ok: false, error: 'code field required (string)' }, 400);
          return;
        }
        const codePath = resolve(__dirname, 'instances', 'se_custom_code.js');
        fs.writeFileSync(codePath, code, 'utf-8');
        sendJson(res, { ok: true, saved: codePath });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  // GET /strategy-runner/status
  if (req.method === 'GET' && req.url === '/strategy-runner/status') {
    try {
      const status = strategyRunnerSe.getStatus();
      // window 字段由 getStatus() 内部返回（含 remaining_sec/period/slug），此处不再覆写
      sendJson(res, status);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // GET /strategy-runner/logs
  if (req.method === 'GET' && req.url === '/strategy-runner/logs') {
    try {
      sendJson(res, strategyRunnerSe.getLogs());
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/bot/test/run') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const taskIdRaw = String(payload?.task_id || '').trim();
        const taskId = taskIdRaw || `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}_900`;
        const simulateFail = payload?.simulate_fail === true;
        const moduleKey = String(payload?.module_key || 'allchain').trim().toLowerCase();
        const started = launchBotTestRun({ taskId, simulateFail, moduleKey });
        if (started.ok === false) {
          sendJson(res, started, 400);
          return;
        }
        sendJson(res, started, started.started ? 200 : 409);
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/test/status')) {
    sendJson(res, { ok: true, ...getBotTestStatusSnapshot() });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/test/logs')) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const limitText = parsed.searchParams.get('limit');
      const limit = limitText == null ? 200 : Number.parseInt(limitText, 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        sendJson(res, { ok: false, error: 'invalid limit' }, 400);
        return;
      }
      const logFile = botTestRunnerState.log_file;
      if (!logFile || !existsSync(logFile)) {
        sendJson(res, { ok: true, lines: [], log_file: null, state: botTestRunnerState.state });
        return;
      }
      const lines = readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
      sendJson(res, {
        ok: true,
        state: botTestRunnerState.state,
        log_file: logFile,
        lines: lines.slice(Math.max(0, lines.length - Math.min(limit, 500)))
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/test/result')) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const runId = String(parsed.searchParams.get('run_id') || '').trim();
      const moduleKey = String(parsed.searchParams.get('module_key') || '').trim();
      if (runId && runId !== String(botTestRunnerState.run_id || '')) {
        sendJson(res, { ok: false, error: 'stale run_id', state: botTestRunnerState.state, run_id: botTestRunnerState.run_id }, 409);
        return;
      }
      if (moduleKey && moduleKey !== String(botTestRunnerState.module_key || '')) {
        sendJson(res, { ok: false, error: 'stale module_key', state: botTestRunnerState.state, module_key: botTestRunnerState.module_key }, 409);
        return;
      }
      if (botTestRunnerState.state === BOT_TEST_STATE_RUNNING) {
        sendJson(res, { ok: false, error: 'result not ready', state: botTestRunnerState.state, run_id: botTestRunnerState.run_id }, 409);
        return;
      }
      const resultFile = botTestRunnerState.result_file;
      if (!resultFile || !existsSync(resultFile)) {
        sendJson(res, { ok: false, error: 'result not ready', state: botTestRunnerState.state }, 404);
        return;
      }
      const result = JSON.parse(readFileSync(resultFile, 'utf8'));
      sendJson(res, {
        ok: true,
        state: botTestRunnerState.state,
        overall_pass: botTestRunnerState.overall_pass,
        run_id: botTestRunnerState.run_id,
        module_key: botTestRunnerState.module_key,
        module_label: botTestRunnerState.module_label,
        result_file: resultFile,
        result
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/logs')) {
    ensureBotRecoveryHydrated();
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const limitText = parsed.searchParams.get('limit');
      const limit = limitText == null ? 200 : Number.parseInt(limitText, 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        sendJson(res, { ok: false, error: 'invalid limit' }, 400);
        return;
      }
      sendJson(res, botLogger.getRecentLogs(Math.min(limit, 500)));
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/status') {
    ensureBotRecoveryHydrated();
    try {
      const state = botState.getState();
      const currentWindowId = state.running === true ? (state.current_window_id ?? null) : null;
      const activeConfigSnapshot = getBotActiveRuntimeConfig() || getBotConfigSnapshot();
      sendJson(res, {
        ...state,
        current_window_id: currentWindowId,
        saved_config: getBotConfigSnapshot(),
        last_run_snapshot: getBotLastRunSnapshot(),
        active_runtime_snapshot: {
          config: activeConfigSnapshot,
          phase: state.phase ?? null,
          current_window_id: currentWindowId,
          anchor_btc: state.anchor_btc ?? null,
          upper_bound: state.upper_bound ?? null,
          lower_bound: state.lower_bound ?? null,
          running: state.running === true
        }
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/account') {
    ensureBotRecoveryHydrated();
    try {
      const account = await getBotAccountSnapshot();
      sendJson(res, {
        ok: true,
        account
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/performance/summary')) {
    ensureBotRecoveryHydrated();
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const presetRaw = parsed.searchParams.get('preset');
      const includeRows = parsed.searchParams.get('detail') === '1';
      const summary = await queryBotPerformanceSummary(presetRaw, includeRows);
      sendJson(res, {
        ok: true,
        summary
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/context') {
    ensureBotRecoveryHydrated();
    try {
      const context = await botContextAdapter.getContext();
      sendJson(res, context);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/orders') {
    ensureBotRecoveryHydrated();
    try {
      const state = botState.getState();
      const { allOrders } = buildBotOrdersWithWindowIds();
      const { running, activeWindowId, displayWindowId, scope } = resolveBotWindowScope(state);
      const { windowOrders, hiddenOtherWindowCount } = selectWindowOrdersForDisplay(allOrders, {
        displayWindowId,
        running,
        windowInitializedAt: state?.window_initialized_at
      });
      sendJson(res, {
        orders: windowOrders,
        window_orders: windowOrders,
        all_orders: allOrders,
        context_snapshot: botLastTickResult?.context_snapshot || null,
        context_snapshot_at: state?.last_tick_at || null,
        summary: botExecutorPaper.getSummary(),
        window_scope: {
          scope,
          running,
          active_window_id: activeWindowId,
          display_window_id: displayWindowId,
          label: scope === 'current_window'
            ? '当前窗口订单'
            : (scope === 'last_window' ? '上一窗口订单（停止态）' : '当前无可展示窗口订单'),
          ownership_rule: scope === 'current_window'
            ? '运行中仅展示当前活动窗口订单'
            : (scope === 'last_window'
              ? '停止态展示上一窗口订单，不冒充当前活动窗口'
              : '无当前活动窗口且无可展示上一窗口订单')
        },
        hidden_other_window_count: hiddenOtherWindowCount
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/paper/summary') {
    try {
      sendJson(res, getBotPaperSummaryScoped());
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/bot/paper/apply-action') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const intents = payload?.intents;
        if (Array.isArray(intents)) {
          const result = botExecutorPaper.applyIntents(intents, { source: 'manual' });
          syncBotStateFromLedger();
          persistBotRecoverySnapshot();
          sendJson(res, {
            ok: true,
            mode: result.mode,
            changed: result.changed,
            applied: result.applied,
            summary: result.summary,
            orders: result.orders
          });
          return;
        }
        const action = payload?.action;
        if (typeof action !== 'string' || !BOT_PAPER_ALLOWED_ACTIONS.includes(action)) {
          sendJson(res, { ok: false, error: 'invalid action' }, 400);
          return;
        }
        const result = botExecutorPaper.applyAction(action, { source: 'manual' });
        syncBotStateFromLedger();
        persistBotRecoverySnapshot();
        sendJson(res, {
          ok: true,
          mode: 'ACTION',
          action: result.action,
          changed: result.changed,
          summary: result.summary,
          orders: result.orders
        });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  if (req.url.startsWith('/bot/')) {
    ensureBotRecoveryHydrated();
  }

  if (req.method === 'POST' && req.url === '/bot/runner/tick') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const contextOverride = payload?.context_override;
        const stateOverride = payload?.state_override;
        if (contextOverride !== undefined && (!contextOverride || typeof contextOverride !== 'object' || Array.isArray(contextOverride))) {
          sendJson(res, { ok: false, error: 'invalid context_override' }, 400);
          return;
        }
        if (stateOverride !== undefined && (!stateOverride || typeof stateOverride !== 'object' || Array.isArray(stateOverride))) {
          sendJson(res, { ok: false, error: 'invalid state_override' }, 400);
          return;
        }
        const result = await botRunner.runSingleTick({
          context_override: contextOverride,
          state_override: stateOverride
        });
        botState.patchState({ last_tick_at: new Date().toISOString() });
        persistBotRecoverySnapshot();
        sendJson(res, { ok: true, ...result });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/bot/config') {
    sendJson(res, {
      current: getBotConfigSnapshot(),
      defaults: cloneBotConfig(BOT_CONFIG_DEFAULTS)
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/bot/config') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const validated = validateBotConfigPayload(payload);
        if (!validated.ok) {
          sendJson(res, { ok: false, error: validated.error }, 400);
          return;
        }
        setBotConfigCurrent(validated.value);
        botLogger.log({
          level: 'info',
          source: 'server',
          event: 'BOT_CONFIG_UPDATED',
          message: 'bot config updated',
          mode: BOT_MODE,
          window_id: null,
          data: getBotConfigSnapshot()
        });
        sendJson(res, {
          ok: true,
          current: getBotConfigSnapshot(),
          defaults: cloneBotConfig(BOT_CONFIG_DEFAULTS)
        });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/bot/start') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const rawInterval = payload?.tick_interval_ms;
        const debugScenario = payload?.debugScenario;
        const tickIntervalMs = rawInterval == null ? BOT_TICK_INTERVAL_DEFAULT_MS : Number(rawInterval);
        if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < BOT_TICK_INTERVAL_MIN_MS || tickIntervalMs > BOT_TICK_INTERVAL_MAX_MS) {
          sendJson(res, { ok: false, error: 'invalid tick_interval_ms' }, 400);
          return;
        }
        if (debugScenario != null && typeof debugScenario !== 'string') {
          sendJson(res, { ok: false, error: 'invalid debugScenario' }, 400);
          return;
        }
        if (typeof debugScenario === 'string' && debugScenario.length > 0) {
          enableBotDebugScenario(debugScenario);
        } else {
          clearBotDebugScenario();
        }
        botLastTickResult = null;
        syncRunnerConfigFromSavedConfig();
        botPendingStopReason = null;
        botRunActionSummary = [];
        const configSnapshot = getBotConfigSnapshot();
        const prevWindowId = botState.getState().current_window_id ?? null;
        botState.patchState({
          last_window_id: prevWindowId,
          current_window_id: null,
          window_initialized_at: null,
          anchor_btc: null,
          atr_5m: null,
          upper_bound: null,
          lower_bound: null,
          ladder_posted: false,
          yes_cancelled: false,
          no_cancelled: false,
          yes_order_ids: [],
          no_order_ids: [],
          phase: 'IDLE'
        });
        syncBotStateFromLedger();
        botActiveRuntimeConfig = cloneBotConfig(configSnapshot);
        const result = botRunner.start(tickIntervalMs);
        persistBotRecoverySnapshot();
        botLogger.log({
          level: 'info',
          source: 'server',
          event: 'BOT_CONFIG_APPLIED',
          message: 'bot start using current config',
          mode: BOT_MODE,
          window_id: null,
          data: configSnapshot
        });
        const state = botState.getState();
        sendJson(res, {
          ok: true,
          ...result,
          config: configSnapshot,
          debugScenario: state.debug_scenario,
          debug_frame_index: state.debug_frame_index,
          debug_completed: state.debug_completed
        });
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 500);
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/bot/stop') {
    try {
      botPendingStopReason = 'MANUAL_STOP';
      const result = botRunner.stop();
      botLastTickResult = null;
      if (result?.already_stopped) {
        botPendingStopReason = null;
      }
      persistBotRecoverySnapshot();
      sendJson(res, { ok: true, ...result });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/bot/decision-preview')) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const fixtureId = parsed.searchParams.get('fixture');
      const stateCurrent = botState.getState();
      if (!fixtureId && stateCurrent?.running === true && botLastTickResult?.decision_preview) {
        const preview = botLastTickResult.decision_preview || {};
        sendJson(res, {
          intents: preview.intents || [],
          intents_summary: preview.intents_summary || summarizeIntents(preview.intents || []),
          reason: preview.reason || null,
          patches: preview.patches || null,
          diagnostics: preview.diagnostics || null,
          config: getBotConfigSnapshot(),
          context_snapshot: botLastTickResult.context_snapshot || preview.context_snapshot || null,
          state_snapshot: { ladder_posted: (botLastTickResult.state_after?.ladder_posted ?? false) === true },
          fixture: null
        });
        return;
      }
      let context = await botContextAdapter.getContext();
      let state = botState.getState();
      if (state?.running === true) {
        const btcRaw = context?.btc_price;
        const btcReady = btcRaw !== null && btcRaw !== undefined && Number.isFinite(Number(btcRaw));
        const boundsReady = Number.isFinite(Number(state?.anchor_btc))
          && Number.isFinite(Number(state?.upper_bound))
          && Number.isFinite(Number(state?.lower_bound));
        const currentWindowPresent = state?.current_window_id != null;
        const waitReason = !currentWindowPresent
          ? 'wait_window_id_not_ready'
          : (!btcReady
            ? 'gate_context_not_ready_btc_price'
            : (!boundsReady ? 'wait_context_bounds_not_ready' : 'wait_runner_tick_result'));
        sendJson(res, {
          intents: [{ kind: 'NOOP' }],
          intents_summary: 'NOOP',
          reason: waitReason,
          patches: {},
          diagnostics: {
            gate_context_not_ready: waitReason.startsWith('gate_context_not_ready'),
            gate_reason: waitReason,
            gate_current_window_present: currentWindowPresent,
            gate_btc_ready: btcReady,
            gate_bounds_ready: boundsReady,
            gate_window_initialized: Boolean(state?.window_initialized_at)
          },
          config: getBotConfigSnapshot(),
          context_snapshot: context,
          state_snapshot: { ladder_posted: state?.ladder_posted === true },
          fixture: null
        });
        return;
      }
      let fixture = null;
      if (fixtureId) {
        fixture = getDecisionFixtures().find(item => item.id === fixtureId) || null;
        if (!fixture) {
          sendJson(res, { ok: false, error: `unknown fixture: ${fixtureId}` }, 404);
          return;
        }
        context = { ...context, ...fixture.context };
        state = { ...state, ...fixture.state };
      }
      const decision = decideBotAction({
        config: toInternalRunnerConfig(getBotConfigSnapshot()),
        context,
        state
      });
      sendJson(res, {
        intents: decision.intents,
        intents_summary: summarizeIntents(decision.intents),
        reason: decision.reason,
        patches: decision.patches,
        diagnostics: decision.diagnostics,
        config: getBotConfigSnapshot(),
        context_snapshot: context,
        state_snapshot: { ladder_posted: state.ladder_posted === true },
        fixture: fixture ? { id: fixture.id, label: fixture.label, expected: fixture.expected || null } : null
      });
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // 重启服务接口
  if (req.method === 'POST' && req.url === '/server/restart') {
    sendJson(res, { ok: true, msg: '正在重启...' });
    setTimeout(() => {
      process.exit(0);
    }, 200);
    return;
  }

  // ── 静态资源服务（兜底）───────────────────────────────────────────────
  if (req.method === 'GET' || req.method === 'HEAD') {
    // 映射 /ui/* -> ../../ui/*
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/ui/')) {
      const relPath = decodeURIComponent(pathname.slice('/ui/'.length));
      const absPath = resolve(__dirname, '..', '..', 'ui', relPath);
      // 安全检查：防止目录穿越
      if (!absPath.startsWith(resolve(__dirname, '..', '..', 'ui'))) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (existsSync(absPath) && statSync(absPath).isFile()) {
        const ext = extname(absPath);
        const mime = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          createReadStream(absPath).pipe(res);
        }
        return;
      }
    }
    // 映射根目录 -> ../../ui/btcqdd.html
    if (req.url === '/' || req.url === '/index.html') {
      const absPath = resolve(__dirname, '..', '..', 'ui', 'btcqdd.html');
      if (existsSync(absPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          createReadStream(absPath).pipe(res);
        }
        return;
      }
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});

server.listen(PORT, () => {
  logger.info(EVENTS.SERVER_START, { module: 'server', msg: `listening on http://localhost:${PORT}`, strategy: STRATEGY_ID });
  botLogger.log({
    level: 'info',
    source: 'server',
    event: 'SERVER_LISTENING',
    message: `server listening on ${PORT}`,
    mode: BOT_MODE,
    window_id: null,
    data: { port: PORT, strategy: STRATEGY_ID || 'none' }
  });
});

// ── WebSocket /events/stream ────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/events/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  logger.info('ws_connect_ok', { module: 'server', path: '/events/stream' });

  const handler = (event) => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)); }
      catch (e) { logger.error('ws_send_fail', { module: 'server', err: e.message }); }
    }
  };

  subscribe(handler);

  // 连接确认帧
  ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }));

  ws.on('close', () => {
    unsubscribe(handler);
    logger.info('ws_disconnect', { module: 'server', path: '/events/stream' });
  });

  ws.on('error', (e) => {
    logger.error('ws_error', { module: 'server', path: '/events/stream', err: e.message });
    unsubscribe(handler);
  });
});
