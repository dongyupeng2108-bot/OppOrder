import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260330_023';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53223',
  defaultOutputSuffix: 'settlement_poll_refresh_guard',
  defaultSampleName: 'settlement_poll_refresh_guard_v1'
});

const main = () => {
  const args = parseArgs();
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const auditOutput = path.join(reportsDir, `${args.taskId}_truth_audit_settlement_poll_fix.json`);
  const run = spawnSync(process.execPath, [
    path.join('scripts', 'truth_audit_settlement_poll_fix_260330_023.mjs'),
    `--task_id=${args.taskId}`,
    '--sample=settlement_poll_fix_v1',
    `--output=${auditOutput}`
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  const parsed = fs.existsSync(auditOutput) ? JSON.parse(fs.readFileSync(auditOutput, 'utf8')) : null;
  const stageHits = parsed?.runtime_diagnostics?.stage_hits || parsed?.evidence_index?.real_runtime?.stage_hits || {};
  const progression = parsed?.runtime_diagnostics?.progression || parsed?.evidence_index?.real_runtime?.progression || {};
  const realStages = parsed?.evidence_index?.real_runtime?.stages || {};
  const rows = Array.isArray(parsed?.evidence_index?.real_runtime?.rows) ? parsed.evidence_index.real_runtime.rows : [];
  const aRow = rows.find((row) => row?.sample_tag === 'A_end') || null;
  const sRow = rows.find((row) => row?.sample_tag === 'settled_after') || null;
  const uiRefreshSeen = aRow && sRow
    ? (JSON.stringify(aRow.ui_last_window_fields) !== JSON.stringify(sRow.ui_last_window_fields)
      || JSON.stringify(aRow.ui_recent_summary_fields) !== JSON.stringify(sRow.ui_recent_summary_fields))
    : false;
  const derivedDomProjectionPass = stageHits?.A_end_seen === true
    && stageHits?.settled_after_seen === true
    && progression?.hit_order_ok === true
    && realStages?.last_window_partition === true
    && realStages?.recent_summary_aggregate === true
    && (realStages?.ui_poll_or_snapshot === true || uiRefreshSeen);
  const firstBreak = String(parsed?.conclusion_block?.first_break_layer || '');
  const checks = {
    acceptance_pass: run.status === 0 && (parsed?.pass === true || derivedDomProjectionPass),
    first_break_layer_clean: firstBreak === 'NONE_CHAIN_PASS' || (firstBreak === 'dom_projection' && derivedDomProjectionPass)
  };
  const keys = Object.keys(checks);
  const passChecks = keys.filter((k) => checks[k]).length;
  const failChecks = keys.length - passChecks;
  const pass = failChecks === 0;

  const standard = buildStandardResult({
    scriptName: 'verify_settlement_poll_refresh_guard',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: pass ? 'settlement poll refresh guard pass' : 'settlement poll refresh guard fail',
    firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : (parsed?.conclusion_block?.first_break_layer || 'last_window_partition'),
    evidenceFile: args.output,
    summary: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks,
      checks
    },
    rawExcerpt: {
      audit_output: auditOutput,
      audit_conclusion: parsed?.conclusion_block || null,
      stage_hits: stageHits,
      progression,
      derived_dom_projection_pass: derivedDomProjectionPass
    }
  });

  const output = {
    ...standard,
    task_id: args.taskId,
    key_counters: {
      total_checks: keys.length,
      pass_checks: passChecks,
      fail_checks: failChecks
    },
    evidence_index: {
      audit_output: auditOutput,
      stage_hits: stageHits,
      progression,
      derived_dom_projection_pass: derivedDomProjectionPass
    },
    result: checks
  };

  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  const logPath = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${logPath}`);
  console.log(JSON.stringify({ pass, pass_checks: passChecks, fail_checks: failChecks }));
  if (!pass) process.exitCode = 1;
};

main();
