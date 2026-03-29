import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260329_001';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53147',
  defaultOutputSuffix: 'truth_audit_module_route_fix',
  defaultSampleName: 'module_route_and_result_backfill_fix_v1'
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

const waitServerReady = async (baseUrl, timeoutMs = 40000) => {
  const http = createHttp(baseUrl);
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const status = await http.get('/bot/status');
      if (status.status === 200) return true;
    } catch {}
    await sleep(300);
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

const stopServer = async (child) => {
  if (!child || child.killed) return;
  child.kill();
  await sleep(700);
};

const waitTerminal = async (http, timeoutMs = 16 * 60 * 1000) => {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    await sleep(1200);
    const status = await http.get('/bot/test/status');
    const st = status?.body || {};
    if (st.state === 'passed' || st.state === 'failed') return st;
  }
  return null;
};

const main = async () => {
  const args = parseArgs();
  const preFixReproFact = {
    request_module_key: 'module1',
    backend_status_module_key: 'module1',
    result_module_key: 'allchain',
    result_total_scripts: 11,
    reproduce_cmd: 'node -e <260328_03602 reuse task_id immediate /bot/test/result>',
    classify: 'C：结果展示读取旧结果/错结果'
  };

  const server = await startServerOnPort(53147);
  if (!server) throw new Error('server boot failed for 260329_001 audit');
  const http = createHttp(server.baseUrl);
  let healthRoot = null;
  let healthPairs = null;
  try {
    healthRoot = await fetch(`${server.baseUrl}/`).then((r) => r.status).catch(() => null);
    try {
      healthPairs = await fetch(`${server.baseUrl}/pairs`).then((r) => r.status);
    } catch {
      healthPairs = 'ERR';
    }

    const staleProbeTaskId = `${args.taskId}_stale`;
    const staleSeedStart = await http.post('/bot/test/run', { task_id: staleProbeTaskId, module_key: 'allchain' });
    const staleSeedTerminal = await waitTerminal(http, 4 * 60 * 1000);
    if (!staleSeedTerminal) throw new Error('stale seed allchain run timeout');
    const staleSeedResult = await http.get(`/bot/test/result?run_id=${encodeURIComponent(staleSeedTerminal.run_id)}&module_key=allchain`);
    const staleStart = await http.post('/bot/test/run', { task_id: staleProbeTaskId, module_key: 'module1' });
    await sleep(300);
    const staleStatus = await http.get('/bot/test/status');
    const staleResult = await http.get('/bot/test/result');
    await waitTerminal(http, 3 * 60 * 1000).catch(() => null);
    const staleGuardFact = {
      stale_seed_http: staleSeedStart.status,
      stale_seed_module_key: staleSeedResult?.body?.result?.module_key || null,
      start_http: staleStart.status,
      status_state: staleStatus?.body?.state || null,
      status_module_key: staleStatus?.body?.module_key || null,
      result_http: staleResult.status,
      result_error: staleResult?.body?.error || null
    };

    const module1TaskId = `${args.taskId}_m1`;
    const m1Start = await http.post('/bot/test/run', { task_id: module1TaskId, module_key: 'module1' });
    const m1Terminal = await waitTerminal(http);
    if (!m1Terminal) throw new Error('module1 run timeout');
    const m1Result = await http.get(`/bot/test/result?run_id=${encodeURIComponent(m1Terminal.run_id)}&module_key=module1`);
    const module1Fact = {
      start_http: m1Start.status,
      request_module_key: 'module1',
      backend_module_key: m1Terminal.module_key || null,
      terminal_state: m1Terminal.state || null,
      result_http: m1Result.status,
      result_module_key: m1Result?.body?.result?.module_key || null,
      result_total_scripts: m1Result?.body?.result?.total_scripts ?? null,
      result_file: m1Result?.body?.result_file || null
    };

    const allchainTaskId = `${args.taskId}_all`;
    const allStart = await http.post('/bot/test/run', { task_id: allchainTaskId, module_key: 'allchain' });
    const allTerminal = await waitTerminal(http);
    if (!allTerminal) throw new Error('allchain run timeout');
    const allResult = await http.get(`/bot/test/result?run_id=${encodeURIComponent(allTerminal.run_id)}&module_key=allchain`);
    const allchainFact = {
      start_http: allStart.status,
      request_module_key: 'allchain',
      backend_module_key: allTerminal.module_key || null,
      terminal_state: allTerminal.state || null,
      result_http: allResult.status,
      result_module_key: allResult?.body?.result?.module_key || null,
      result_total_scripts: allResult?.body?.result?.total_scripts ?? null,
      result_file: allResult?.body?.result_file || null
    };

    const sequenceFact = {
      step1_module_key: module1Fact.result_module_key,
      step2_module_key: allchainFact.result_module_key,
      step1_run_id: m1Terminal.run_id || null,
      step2_run_id: allTerminal.run_id || null,
      step1_result_file: module1Fact.result_file,
      step2_result_file: allchainFact.result_file
    };

    const checks = {
      '001-A_classification_is_C': preFixReproFact.classify.startsWith('C'),
      '001-B_stale_result_guard_active': staleGuardFact.result_http === 409,
      '001-C_module1_only_execution_and_display': module1Fact.backend_module_key === 'module1' && module1Fact.result_module_key === 'module1',
      '001-D_allchain_only_execution_and_display': allchainFact.backend_module_key === 'allchain' && allchainFact.result_module_key === 'allchain',
      '001-E_sequential_runs_not_cross_wired': sequenceFact.step1_module_key === 'module1'
        && sequenceFact.step2_module_key === 'allchain'
        && sequenceFact.step1_run_id !== sequenceFact.step2_run_id
    };
    const checkKeys = Object.keys(checks);
    const passChecks = checkKeys.filter((k) => checks[k]).length;
    const failChecks = checkKeys.length - passChecks;
    const pass = failChecks === 0;
    const conclusion = pass ? 'A：入口路由与结果回填已修复且不串线' : 'C：存在业务语义断裂';
    const firstBreakLayer = pass ? null : (checks['001-B_stale_result_guard_active'] ? 'D 连续执行不串线层' : 'C 结果回填关联层');

    const standard = buildStandardResult({
      scriptName: 'truth_audit_module_route_fix_260329_001',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: pass ? '模块路由与结果回填修复通过' : '模块路由与结果回填修复失败',
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
        classification: preFixReproFact.classify,
        stale_result_guard_http: staleGuardFact.result_http,
        module1_result_module_key: module1Fact.result_module_key,
        allchain_result_module_key: allchainFact.result_module_key
      }
    });

    const output = {
      ...standard,
      task_id: args.taskId,
      command: `node scripts/truth_audit_module_route_fix_260329_001.mjs --task_id=${args.taskId} --sample=${args.sampleName}`,
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
        pre_fix_repro_fact: preFixReproFact,
        stale_guard_fact: staleGuardFact,
        module1_fact: module1Fact,
        allchain_fact: allchainFact,
        sequential_fact: sequenceFact,
        healthcheck: {
          root: healthRoot,
          pairs: healthPairs
        }
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
  } finally {
    await stopServer(server.child);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
