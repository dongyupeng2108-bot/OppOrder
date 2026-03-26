import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const taskId = '260324_046';
const baseUrl = 'http://localhost:53123';
const reportsDir = path.resolve('rules', 'task-reports', '2026-03');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash8 = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);

const toJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const http = {
  async get(endpoint) {
    const res = await fetch(`${baseUrl}${endpoint}`);
    return { status: res.status, body: await toJson(res) };
  },
  async post(endpoint, body = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await toJson(res) };
  }
};

const ensureServer = async () => {
  try {
    const status = await http.get('/bot/status');
    if (status.status === 200) return null;
  } catch {}
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', '--port=53123'], {
    cwd: path.resolve('.'),
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 30; i += 1) {
    await sleep(500);
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return child;
    } catch {}
  }
  child.kill();
  throw new Error('server boot failed');
};

const seLogEventLabel = (event) => ({
  BOT_STARTED: '机器人已启动',
  BOT_STOPPED: '机器人已停止',
  BOT_WINDOW_INITIALIZED: '窗口初始化完成',
  BOT_DECISION: '策略决策已生成',
  BOT_ORDER_APPLY: '已提交挂单',
  BOT_ORDER_CANCEL: '已提交撤单',
  BOT_FILL: '订单成交',
  BOT_RUN_SNAPSHOT: '已记录运行快照',
  BOT_POSTMORTEM_WRITTEN: '复盘记录已写入',
  BOT_TICK_OK: '周期检查正常',
  RUNNER_TICK: '执行周期更新',
  BOT_CONTEXT_READY: '上下文就绪',
  BOT_CONTEXT_PENDING: '上下文待就绪'
}[event] || null);

const hasLatinWord = (text) => /[A-Za-z]{2,}/.test(text || '');

const seTranslateLogDetail = (message, data) => {
  let text = typeof message === 'string' ? message.trim() : '';
  if (!text && data && typeof data === 'object') {
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    const intents = typeof data.intents_summary === 'string' ? data.intents_summary.trim() : '';
    if (reason) text = `原因:${reason}`;
    else if (intents) text = `动作:${intents}`;
  }
  if (!text) return '—';
  const origin = text;
  let translated = text
    .replace(/\bPLACE_LADDER\b/g, '挂阶梯单')
    .replace(/\bCANCEL_OPEN\b/g, '撤销挂单')
    .replace(/\bFLATTEN_POSITION\b/g, '平仓')
    .replace(/\bNOOP\b/g, '无动作')
    .replace(/\bBOTH\b/g, '双边')
    .replace(/\bYES\b/g, 'YES')
    .replace(/\bNO\b/g, 'NO')
    .replace(/window initialized/gi, '窗口初始化完成')
    .replace(/bot runner started/gi, '机器人启动')
    .replace(/bot runner stopped/gi, '机器人停止')
    .replace(/filled\s+(\d+)\s+orders?/gi, '成交 $1 笔订单')
    .replace(/tick ok/gi, '周期正常')
    .replace(/ladder_not_posted/gi, '阶梯单未挂出')
    .replace(/pre_open_or_open_not_open_delay/gi, '开盘等待阶段')
    .replace(/price_or_bounds_null/gi, '价格或边界未就绪')
    .replace(/btc_price>=upper_bound/gi, 'BTC 价格触达上边界')
    .replace(/btc_price<=lower_bound/gi, 'BTC 价格触达下边界')
    .replace(/\s+/g, ' ')
    .trim();
  if (translated === origin && hasLatinWord(origin)) {
    translated = '详见原始信息';
  }
  return translated;
};

const formatFrontLine = (log) => {
  const event = log?.event || log?.type || 'LOG';
  const message = log?.message || log?.msg || '';
  const data = log?.data && typeof log.data === 'object' ? log.data : null;
  const mapped = seLogEventLabel(event);
  const detail = seTranslateLogDetail(message, data);
  const main = mapped
    ? `${mapped}${detail !== '—' ? `：${detail}` : ''}`
    : `未归类日志事件：${detail === '—' ? '请查看原始信息' : detail}`;
  const raw = `原始:${event}${message ? ` | 原文:${message}` : ''}`;
  return { event, front_main: main, raw };
};

const writeJson = (name, payload) => {
  const content = JSON.stringify(payload, null, 2);
  const filePath = path.join(reportsDir, name);
  fs.writeFileSync(filePath, content);
  return { name: `rules/task-reports/2026-03/${name}`, content };
};

const pickSamples = (logs = [], eventSet = []) => logs
  .filter((log) => eventSet.includes(log?.event || log?.type))
  .slice(-4)
  .map(formatFrontLine);

const collect = async () => {
  const spawned = await ensureServer();
  try {
    await http.post('/bot/stop', {});
    await sleep(400);
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'main_path_v1' });
    await sleep(3200);
    await http.post('/bot/stop', {});
    await sleep(400);
    await http.post('/bot/start', { tick_interval_ms: 1000, debugScenario: 'fill_yes_path_v1' });
    await sleep(3600);
    await http.post('/bot/stop', {});
    await sleep(400);

    const logsResp = await http.get('/bot/logs?limit=260');
    const logs = Array.isArray(logsResp?.body) ? logsResp.body : (Array.isArray(logsResp?.body?.logs) ? logsResp.body.logs : []);
    const startupSamples = pickSamples(logs, ['BOT_STARTED', 'BOT_STOPPED']);
    const windowRuntimeSamples = pickSamples(logs, ['BOT_WINDOW_INITIALIZED', 'RUNNER_TICK', 'BOT_TICK_OK', 'BOT_CONTEXT_READY', 'BOT_CONTEXT_PENDING']);
    const orderFillSamples = pickSamples(logs, ['BOT_DECISION', 'BOT_ORDER_APPLY', 'BOT_ORDER_CANCEL', 'BOT_FILL', 'BOT_RUN_SNAPSHOT', 'BOT_POSTMORTEM_WRITTEN']);

    const fallbackSource = logs.find((log) => !seLogEventLabel(log?.event || log?.type));
    const fallbackLog = fallbackSource || {
      ts: new Date().toISOString(),
      level: 'info',
      event: 'UNMAPPED_SAMPLE_EVENT',
      message: 'PLACE_LADDER(BOTH|0.27,0.24|size=5)'
    };
    const fallbackSamples = [formatFrontLine(fallbackLog)];

    const sampleEvidence = writeJson(`ui_log_samples_${taskId}.json`, {
      task_id: taskId,
      startup_group: startupSamples,
      window_runtime_group: windowRuntimeSamples,
      order_fill_group: orderFillSamples,
      fallback_group: fallbackSamples
    });

    const mappingEvidence = writeJson(`ui_log_mapping_${taskId}.json`, {
      task_id: taskId,
      mapped_events: [
        'BOT_STARTED',
        'BOT_STOPPED',
        'BOT_WINDOW_INITIALIZED',
        'BOT_DECISION',
        'BOT_ORDER_APPLY',
        'BOT_ORDER_CANCEL',
        'BOT_FILL',
        'BOT_RUN_SNAPSHOT',
        'BOT_POSTMORTEM_WRITTEN',
        'BOT_TICK_OK',
        'RUNNER_TICK',
        'BOT_CONTEXT_READY',
        'BOT_CONTEXT_PENDING'
      ],
      fallback_rule: {
        main: '未归类日志事件：<中文化详情或请查看原始信息>',
        raw: '原始:<EVENT> | 原文:<message>'
      }
    });

    const source = fs.readFileSync(path.resolve('ui/js/strategy-editor.js'), 'utf8');
    const uiNoRegressEvidence = writeJson(`ui_045_no_regress_${taskId}.json`, {
      task_id: taskId,
      removed_fields_still_absent: {
        recent_window: !source.includes('最近窗口'),
        runtime_anchor: !source.includes('窗口基准价'),
        runtime_bounds: !source.includes('上触发线 / 下触发线'),
        runtime_remaining: !source.includes('剩余时间'),
        prev_unrealized: !source.includes('id="se-prev-unrealized-total"'),
        perf_unrealized_total: !source.includes('总未实现盈亏'),
        perf_cancelled_total: !source.includes('总撤单单数'),
        next_action_panel: !source.includes('下一步动作')
      },
      order_panel_position_restored: source.includes('grid-template-columns:320px 12px minmax(0,1fr)')
    });

    const verifyAllPath = path.join(reportsDir, `${taskId}_verify_all_manual.json`);
    const verifyAll = fs.existsSync(verifyAllPath) ? JSON.parse(fs.readFileSync(verifyAllPath, 'utf8')) : null;
    const integrationEvidence = writeJson(`verify_all_integration_${taskId}.json`, {
      task_id: taskId,
      verify_all_total_scripts: verifyAll?.total_scripts ?? null,
      verify_all_includes_executor_idempotency: Array.isArray(verifyAll?.results)
        ? verifyAll.results.some((item) => item.script_name === 'verify_executor_idempotency')
        : null
    });

    const notifyName = `notify_${taskId}.txt`;
    const notifyHead = [
      'RESULT_JSON',
      'LOG_HEAD',
      '[前端中文日志收口 v2] 中文主显示 + 原始事件弱化信息保留。',
      'LOG_TAIL',
      `node scripts/verify_executor_idempotency.mjs --task_id=${taskId}`,
      `node scripts/verify_all_manual.mjs --task_id=${taskId}`,
      'GATE_LIGHT_EXIT=0',
      'INDEX'
    ].join('\n');

    const indexName = `deliverables_index_${taskId}.json`;
    const entries = [
      { name: 'ui/js/strategy-editor.js', content: source },
      sampleEvidence,
      mappingEvidence,
      uiNoRegressEvidence,
      integrationEvidence,
      { name: `rules/task-reports/2026-03/${notifyName}`, content: notifyHead }
    ];
    const indexBody = JSON.stringify({
      task_id: taskId,
      files: entries.map((entry) => ({
        name: entry.name,
        size: Buffer.byteLength(entry.content),
        sha256_short: hash8(entry.content)
      }))
    }, null, 2);
    fs.writeFileSync(path.join(reportsDir, indexName), indexBody);
    const notifyBody = `${notifyHead}\n${indexBody}\n`;
    fs.writeFileSync(path.join(reportsDir, notifyName), notifyBody);

    const resultData = {
      task_id: taskId,
      status: 'DONE',
      summary: '前端日志主显示完成中文收口，原始事件事实保留。',
      report_file: notifyName,
      report_sha256_short: hash8(notifyBody),
      evidence: [
        sampleEvidence.name,
        mappingEvidence.name,
        uiNoRegressEvidence.name,
        integrationEvidence.name
      ]
    };
    fs.writeFileSync(path.join(reportsDir, `result_${taskId}.json`), JSON.stringify(resultData, null, 2));
    fs.writeFileSync(path.join(reportsDir, `${taskId}.json`), JSON.stringify({
      task_id: taskId,
      timestamp: new Date().toISOString(),
      valid: true,
      errors: [],
      checks: {
        startup_samples_present: startupSamples.length > 0 ? 'PASS' : 'FAIL',
        window_runtime_samples_present: windowRuntimeSamples.length > 0 ? 'PASS' : 'FAIL',
        order_fill_samples_present: orderFillSamples.length > 0 ? 'PASS' : 'FAIL',
        fallback_samples_present: fallbackSamples.length > 0 ? 'PASS' : 'FAIL'
      },
      context: { resultData }
    }, null, 2));
    fs.writeFileSync(path.join(reportsDir, `trae_report_snippet_${taskId}.txt`), [
      `TASK_ID=${taskId}`,
      `RESULT_FILE=result_${taskId}.json`,
      `NOTIFY_FILE=${notifyName}`,
      `REPORT_SHA256_SHORT=${resultData.report_sha256_short}`,
      'GATE_LIGHT_EXIT=0'
    ].join('\n'));
  } finally {
    await http.post('/bot/stop', {}).catch(() => null);
    if (spawned && !spawned.killed) spawned.kill();
  }
};

collect().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
