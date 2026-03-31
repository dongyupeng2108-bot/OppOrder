import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const parseArgs = () => {
  const base = parseVerifyArgs({
    defaultTaskId: '260330_019',
    defaultBaseUrl: 'http://localhost:53218',
    defaultOutputSuffix: 'layered_local_verify',
    defaultSampleName: 'layered_local_verify_v1'
  });
  const raw = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((item) => item.startsWith('--'))
      .map((item) => {
        const [k, ...rest] = item.slice(2).split('=');
        return [k, rest.join('=') || 'true'];
      })
  );
  return {
    ...base,
    mode: String(raw.mode || 'dev-fast'),
    module: String(raw.module || 'p1guard'),
    auditScript: raw.audit_script || null,
    guardScript: raw.guard_script || null
  };
};

const resolveTaskAuditScript = (taskId) => {
  const scriptsDir = path.join(REPO_ROOT, 'scripts');
  const files = fs.readdirSync(scriptsDir).filter((name) => /^truth_audit_.*_\d+\.mjs$/i.test(name));
  const hit = files
    .filter((name) => name.endsWith(`_${taskId}.mjs`))
    .sort((a, b) => a.localeCompare(b))[0];
  return hit ? `scripts/${hit}` : null;
};

const resolveGuardScript = (module) => {
  const map = {
    p0guard: 'scripts/verify_p0_runtime_fixes_guard.mjs',
    p1guard: 'scripts/verify_no_terminal_state_guard.mjs'
  };
  return map[module] || null;
};

const runNodeCommand = (args) => {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const elapsedMs = Date.now() - startedAt;
  return {
    command: `node ${args.join(' ')}`,
    exit_code: result.status ?? 1,
    elapsed_ms: elapsedMs,
    stdout_tail: String(result.stdout || '').split(/\r?\n/).filter(Boolean).slice(-20),
    stderr_tail: String(result.stderr || '').split(/\r?\n/).filter(Boolean).slice(-20)
  };
};

const runMode = ({ mode, taskId, sampleName, module, auditScript, guardScript }) => {
  const resolvedAudit = auditScript || resolveTaskAuditScript(taskId);
  const resolvedGuard = guardScript || resolveGuardScript(module);
  const commands = [];
  if (mode === 'dev-fast') {
    if (!resolvedAudit) throw new Error('dev-fast requires --audit_script or a task-matched truth_audit script');
    commands.push(['--check', resolvedAudit]);
    commands.push([resolvedAudit, `--task_id=${taskId}`, `--sample=${sampleName}`]);
  } else if (mode === 'guard') {
    if (!resolvedGuard) throw new Error('guard requires --guard_script or known --module mapping');
    commands.push(['--check', resolvedGuard]);
    commands.push([resolvedGuard, `--task_id=${taskId}`, `--sample=${sampleName}`]);
  } else if (mode === 'prepr') {
    commands.push(['scripts/verify_all_manual.mjs', `--task_id=${taskId}`, `--module=${module}`]);
    commands.push(['scripts/finalize_task_evidence.mjs', '--task_id', taskId]);
    commands.push(['scripts/gate_light_ci.mjs', '--task_id', taskId, '--result_dir', 'rules/task-reports/2026-03']);
  } else {
    throw new Error(`unsupported mode: ${mode}`);
  }

  const results = commands.map((cmd) => runNodeCommand(cmd));
  const failed = results.find((item) => item.exit_code !== 0) || null;
  const elapsedMs = results.reduce((sum, item) => sum + item.elapsed_ms, 0);
  return {
    mode,
    task_id: taskId,
    sample: sampleName,
    module,
    audit_script: resolvedAudit,
    guard_script: resolvedGuard,
    commands: results,
    elapsed_ms: elapsedMs,
    pass: failed === null,
    failed_command: failed
  };
};

const main = () => {
  const args = parseArgs();
  const modeResult = runMode({
    mode: args.mode,
    taskId: args.taskId,
    sampleName: args.sampleName,
    module: args.module,
    auditScript: args.auditScript,
    guardScript: args.guardScript
  });

  const checks = {
    mode_supported: ['dev-fast', 'guard', 'prepr'].includes(args.mode),
    all_commands_pass: modeResult.pass === true,
    dev_fast_no_verify_all_manual: args.mode !== 'dev-fast'
      || modeResult.commands.every((item) => !item.command.includes('verify_all_manual')),
    prepr_has_verify_all_finalize_gate: args.mode !== 'prepr'
      || (
        modeResult.commands.some((item) => item.command.includes('verify_all_manual.mjs'))
        && modeResult.commands.some((item) => item.command.includes('finalize_task_evidence.mjs'))
        && modeResult.commands.some((item) => item.command.includes('gate_light_ci.mjs'))
      )
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;

  const standard = buildStandardResult({
    scriptName: 'run_layered_verify',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? `layered verify mode ${args.mode} pass` : `layered verify mode ${args.mode} fail`,
    firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'layered_verify_mode',
    evidenceFile: args.output,
    summary: {
      mode: args.mode,
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: modeResult
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    mode: args.mode,
    elapsed_ms: modeResult.elapsed_ms,
    commands: modeResult.commands,
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    result: checks
  };

  ensureDir(args.output);
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`MODE=${args.mode}`);
  console.log(`TOTAL_ELAPSED_MS=${modeResult.elapsed_ms}`);
  for (const row of modeResult.commands) {
    console.log(`CMD=${row.command}`);
    console.log(`CMD_ELAPSED_MS=${row.elapsed_ms}`);
    console.log(`CMD_EXIT=${row.exit_code}`);
  }
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, mode: args.mode, elapsed_ms: modeResult.elapsed_ms, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main();
