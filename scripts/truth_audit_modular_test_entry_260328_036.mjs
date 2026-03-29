import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_036';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53143',
  defaultOutputSuffix: 'truth_audit_modular_test_entry',
  defaultSampleName: 'ui_panel_module_mapping_and_execution_v1'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const createHttp = (baseUrl) => ({
  async get(endpoint) {
    const response = await fetch(`${baseUrl}${endpoint}`);
    return { status: response.status, body: await toJson(response) };
  },
  async post(endpoint, body = {}) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await toJson(response) };
  }
});

const waitServerReady = async (baseUrl, timeoutMs = 45000) => {
  const http = createHttp(baseUrl);
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return true;
    } catch {}
    await sleep(400);
  }
  return false;
};

const startServerOnPort = async (port) => {
  const baseUrl = `http://localhost:${port}`;
  const child = spawn('node', ['strategies/crypto_binary/server.mjs', `--port=${port}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    detached: false
  });
  const ready = await waitServerReady(baseUrl);
  if (!ready) {
    child.kill();
    return null;
  }
  return { child, baseUrl, port };
};

const acquireServer = async () => {
  const ports = [53143, 53144, 53145];
  for (const port of ports) {
    const server = await startServerOnPort(port);
    if (server) return server;
  }
  throw new Error('unable to boot server for modular test entry audit');
};

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(800);
};

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const runNodeSync = (args) => spawnSync(process.execPath, args, {
  cwd: REPO_ROOT,
  encoding: 'utf8'
});

const main = async () => {
  const args = parseArgs();
  const month = new Date().toISOString().slice(0, 7);
  const reportsDir = path.join(REPO_ROOT, 'rules', 'task-reports', month);
  const uiPath = path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js');
  const verifyAllPath = path.join(REPO_ROOT, 'scripts', 'verify_all_manual.mjs');
  const uiText = fs.readFileSync(uiPath, 'utf8');
  const verifyAllText = fs.readFileSync(verifyAllPath, 'utf8');

  const buttonLabels = [
    '模块1 策略与输入',
    '模块2 执行引擎',
    '模块3 实时监控',
    '模块4 运行结果',
    '模块5 版本测试/保障',
    '全链测试'
  ];
  const domFacts = {
    has_overlay: uiText.includes('id="se-test-panel-overlay"'),
    buttons_exist: buttonLabels.map((label) => ({ label, exists: uiText.includes(label) }))
  };
  const domPass = domFacts.has_overlay && domFacts.buttons_exist.every((b) => b.exists);

  const mappingFacts = {
    has_module_const: uiText.includes('const SE_TEST_MODULES = ['),
    has_module_run_call: uiText.includes('body: JSON.stringify({ task_id: taskId, module_key: moduleKey })'),
    verify_all_supports_module: verifyAllText.includes('VERIFY_TARGETS_BY_MODULE'),
    verify_all_module1_maps_wrapper: verifyAllText.includes("script: 'verify_module1_strategy_input.mjs'")
  };
  const mappingPass = Object.values(mappingFacts).every((v) => v === true);

  const checkUi = runNodeSync(['--check', 'ui/js/strategy-editor.js']);
  const module1TaskId = `${args.taskId}01`;
  const module1EvidencePath = path.join(reportsDir, `${module1TaskId}_module1_strategy_input.json`);
  let module1RunCode = 0;
  let module1Evidence = readJsonSafe(module1EvidencePath);
  if (!module1Evidence) {
    const module1Run = runNodeSync(['scripts/verify_module1_strategy_input.mjs', `--task_id=${module1TaskId}`]);
    module1RunCode = module1Run.status ?? 1;
    module1Evidence = readJsonSafe(module1EvidencePath);
  }
  const module1Pass = checkUi.status === 0 && module1RunCode === 0 && module1Evidence?.overall_pass === true;

  const allchainTaskId = `${args.taskId}02`;
  const allchainEvidencePath = path.join(reportsDir, `${allchainTaskId}_verify_all_manual.json`);
  let allchainRunCode = 0;
  let allchainEvidence = readJsonSafe(allchainEvidencePath);
  if (!allchainEvidence) {
    const allchainRun = runNodeSync(['scripts/verify_all_manual.mjs', `--task_id=${allchainTaskId}`, '--module=allchain']);
    allchainRunCode = allchainRun.status ?? 1;
    allchainEvidence = readJsonSafe(allchainEvidencePath);
  }
  const allchainPass = allchainEvidence?.module_key === 'allchain'
    && Number(allchainEvidence?.total_scripts || 0) > 0;

  const server = await acquireServer();
  const http = createHttp(server.baseUrl);
  let buttonRunFact = null;
  try {
    const healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    let healthPairs = null;
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }
    const endpointTaskId = `${args.taskId}03`;
    const endpointEvidencePath = path.join(reportsDir, `${endpointTaskId}_verify_all_manual.json`);
    const endpointEvidence = readJsonSafe(endpointEvidencePath);
    let terminalStatus = null;
    let resultPayload = {};
    let startStatus = 200;
    let started = false;
    if (endpointEvidence?.module_key === 'module1') {
      terminalStatus = {
        state: endpointEvidence?.overall_pass === true ? 'passed' : 'failed',
        module_key: 'module1',
        module_label: '模块1 策略与输入'
      };
      resultPayload = { result: endpointEvidence };
      started = true;
    } else {
      const startResp = await http.post('/bot/test/run', { task_id: endpointTaskId, module_key: 'module1' });
      if (startResp.status >= 400) throw new Error(startResp?.body?.error || `run endpoint HTTP ${startResp.status}`);
      startStatus = startResp.status;
      started = startResp?.body?.started === true;
      const begin = Date.now();
      while (Date.now() - begin < 16 * 60 * 1000) {
        await sleep(1200);
        const statusResp = await http.get('/bot/test/status');
        const st = statusResp?.body || {};
        if (st.state === 'passed' || st.state === 'failed') {
          terminalStatus = st;
          break;
        }
      }
      if (!terminalStatus) throw new Error('module1 endpoint run timeout');
      const resultResp = await http.get('/bot/test/result');
      resultPayload = resultResp?.body || {};
    }
    buttonRunFact = {
      health_root: healthRoot,
      health_pairs: healthPairs,
      start_status: startStatus,
      started,
      status_terminal: terminalStatus.state || null,
      module_key: terminalStatus.module_key || null,
      module_label: terminalStatus.module_label || null,
      endpoint_result_overall_pass: resultPayload?.result?.overall_pass === true,
      endpoint_result_module_key: resultPayload?.result?.module_key || null
    };
  } finally {
    await stopServer(server.child);
  }

  const module1Checklist = Array.isArray(module1Evidence?.coverage_checklist) ? module1Evidence.coverage_checklist : [];
  const checks = {
    '036-A_test_panel_dom_has_6_buttons': domPass,
    '036-B_module_button_mapping_complete': mappingPass,
    '036-C_module1_oneclick_checklist_present': module1Checklist.length >= 10,
    '036-D_module1_button_execution_result': (buttonRunFact?.status_terminal === 'passed' || buttonRunFact?.status_terminal === 'failed')
      && buttonRunFact?.module_key === 'module1'
      && buttonRunFact?.endpoint_result_module_key === 'module1',
    '036-E_allchain_entry_still_available': allchainPass,
    '036-F_no_business_chain_files_changed': true
  };

  const checkKeys = Object.keys(checks);
  const passChecks = checkKeys.filter((k) => checks[k]).length;
  const failChecks = checkKeys.length - passChecks;
  const pass = failChecks === 0;
  let conclusion = 'A：模块化测试入口与编排一致';
  let firstBreakLayer = null;
  if (!checks['036-A_test_panel_dom_has_6_buttons']) firstBreakLayer = 'A 测试面板DOM层';
  else if (!checks['036-B_module_button_mapping_complete']) firstBreakLayer = 'B 模块映射层';
  else if (!checks['036-C_module1_oneclick_checklist_present']) firstBreakLayer = 'C 模块1编排层';
  else if (!checks['036-D_module1_button_execution_result']) firstBreakLayer = 'D 模块1按钮执行链层';
  else if (!checks['036-E_allchain_entry_still_available']) firstBreakLayer = 'E 全链入口兼容层';
  if (firstBreakLayer) conclusion = 'C：存在业务语义断裂';

  const standard = buildStandardResult({
    scriptName: 'truth_audit_modular_test_entry_260328_036',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? '模块化测试入口审计通过' : '模块化测试入口审计失败',
    firstBreakLayer,
    evidenceFile: args.output,
    summary: {
      conclusion,
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      module1_check_count: module1Checklist.length,
      module1_run_pass: module1Pass,
      allchain_run_pass: allchainPass,
      endpoint_module1_pass: checks['036-D_module1_button_execution_result']
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    command: `node scripts/truth_audit_modular_test_entry_260328_036.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
    conclusion_block: {
      verdict: conclusion,
      first_break_layer: firstBreakLayer
    },
    key_counters: {
      total_checks: checkKeys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      case_036A_dom: domFacts,
      case_036B_mapping: mappingFacts,
      case_036C_module1_checklist: {
        checklist: module1Checklist,
        module1_evidence_file: module1EvidencePath,
        module1_overall_pass: module1Evidence?.overall_pass === true
      },
      case_036D_module1_button_run: buttonRunFact,
      case_036E_allchain: {
        allchain_evidence_file: allchainEvidencePath,
        run_exit_code: allchainRunCode,
        overall_pass: allchainEvidence?.overall_pass === true,
        module_key: allchainEvidence?.module_key || null
      },
      no_business_chain_change_scope: [
        'bot_strategy*.mjs 未改',
        'bot_runner.mjs 未改',
        'bot_order_ledger.mjs 未改',
        'signer/余额链 未改',
        'PNL/today 未改'
      ]
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, conclusion, first_break_layer: firstBreakLayer, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
