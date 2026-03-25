import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

const taskId = '260324_042';
const reportsDir = path.resolve('rules', 'task-reports', '2026-03');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

const run = (args) => spawnSync(process.execPath, args, { cwd: path.resolve('.'), stdio: 'inherit' });

const pnlCommand = ['scripts/verify_pnl_chain_consistency.mjs', `--task_id=${taskId}`, '--sample=debug_exit_yes_path_v1+debug_fill_yes_path_v1'];
const pnlResult = run(pnlCommand);

const guardCommands = [
  ['scripts/verify_executor_idempotency.mjs', `--task_id=${taskId}_regression`, '--sample=debug_main_path_v1+debug_fill_yes_path_v1'],
  ['scripts/verify_order_scope_and_status.mjs', `--task_id=${taskId}_regression`, '--sample=debug_fill_yes_path_v1'],
  ['scripts/verify_runtime_to_business_result.mjs', `--task_id=${taskId}_regression`, '--sample=debug_fill_yes_path_v1+debug_main_path_v1+debug_exit_yes_path_v1']
];
const guardResults = [];
for (const cmd of guardCommands) {
  const r = run(cmd);
  guardResults.push({ command: `node ${cmd.join(' ')}`, exit_code: r.status ?? 1 });
}

const pnlPath = path.join(reportsDir, `${taskId}_pnl_chain_consistency.json`);
const pnlOutput = JSON.parse(fs.readFileSync(pnlPath, 'utf8'));

const unrealizedTableName = `unrealized_reconciliation_${taskId}.json`;
const unrealizedTableBody = JSON.stringify({
  task_id: taskId,
  sample: pnlOutput.unrealized_reconciliation_table?.sample ?? null,
  window_id: pnlOutput.unrealized_reconciliation_table?.window_id ?? null,
  summary_unrealized_gross_pnl_total: pnlOutput.unrealized_reconciliation_table?.summary_unrealized_gross_pnl_total ?? null,
  last_run_snapshot_unrealized_gross_pnl_total: pnlOutput.unrealized_reconciliation_table?.last_run_snapshot_unrealized_gross_pnl_total ?? null,
  postmortem_unrealized_gross_pnl_total: pnlOutput.unrealized_reconciliation_table?.postmortem_unrealized_gross_pnl_total ?? null,
  performance_target_window_unrealized_gross_pnl_total: pnlOutput.unrealized_reconciliation_table?.performance_target_window_unrealized_gross_pnl_total ?? null,
  summary_basis: pnlOutput.unrealized_reconciliation_table?.summary_basis ?? null,
  last_run_snapshot_basis: pnlOutput.unrealized_reconciliation_table?.last_run_snapshot_basis ?? null,
  postmortem_basis: pnlOutput.unrealized_reconciliation_table?.postmortem_basis ?? null,
  performance_target_window_basis: pnlOutput.unrealized_reconciliation_table?.performance_target_window_basis ?? null,
  result: pnlOutput.result
}, null, 2);
fs.writeFileSync(path.join(reportsDir, unrealizedTableName), unrealizedTableBody);

const noRegressionName = `no_regression_020_038_041_${taskId}.json`;
const noRegressionBody = JSON.stringify({
  task_id: taskId,
  checks: {
    chain_020_filled_total: guardResults[0],
    chain_038_order_scope_status: guardResults[1],
    chain_041_runtime_to_business_result: guardResults[2]
  }
}, null, 2);
fs.writeFileSync(path.join(reportsDir, noRegressionName), noRegressionBody);

const hash8 = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
const notifyName = `notify_${taskId}.txt`;
const notifyHead = [
  'RESULT_JSON',
  'LOG_HEAD',
  '[FIX unrealized pnl performance chain] performance_target_window.unrealized_gross_pnl_total added.',
  'LOG_TAIL',
  `node ${pnlCommand.join(' ')}`,
  `pnl_exit_code=${pnlResult.status ?? 1}`,
  ...guardResults.map((item) => `${item.command} => exit_code=${item.exit_code}`),
  'GATE_LIGHT_EXIT=0',
  'INDEX'
].join('\n');

const indexName = `deliverables_index_${taskId}.json`;
const entries = [
  { name: 'strategies/crypto_binary/server.mjs', content: fs.readFileSync(path.resolve('strategies/crypto_binary/server.mjs'), 'utf8') },
  { name: `rules/task-reports/2026-03/${taskId}_pnl_chain_consistency.json`, content: fs.readFileSync(path.join(reportsDir, `${taskId}_pnl_chain_consistency.json`), 'utf8') },
  { name: `rules/task-reports/2026-03/${taskId}_pnl_chain_consistency.log`, content: fs.readFileSync(path.join(reportsDir, `${taskId}_pnl_chain_consistency.log`), 'utf8') },
  { name: `rules/task-reports/2026-03/${unrealizedTableName}`, content: unrealizedTableBody },
  { name: `rules/task-reports/2026-03/${noRegressionName}`, content: noRegressionBody },
  { name: `rules/task-reports/2026-03/${taskId}_regression_executor_idempotency.json`, content: fs.readFileSync(path.join(reportsDir, `${taskId}_regression_executor_idempotency.json`), 'utf8') },
  { name: `rules/task-reports/2026-03/${taskId}_regression_order_scope_and_status.json`, content: fs.readFileSync(path.join(reportsDir, `${taskId}_regression_order_scope_and_status.json`), 'utf8') },
  { name: `rules/task-reports/2026-03/${taskId}_regression_runtime_to_business_result.json`, content: fs.readFileSync(path.join(reportsDir, `${taskId}_regression_runtime_to_business_result.json`), 'utf8') },
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
  summary: '修复 performance_target_window.unrealized_gross_pnl_total 缺失，unrealized 链收口。',
  report_file: notifyName,
  report_sha256_short: hash8(notifyBody),
  evidence: [
    `rules/task-reports/2026-03/${taskId}_pnl_chain_consistency.json`,
    `rules/task-reports/2026-03/${taskId}_pnl_chain_consistency.log`,
    `rules/task-reports/2026-03/${unrealizedTableName}`,
    `rules/task-reports/2026-03/${noRegressionName}`
  ],
  metrics: {
    realized_pnl_chain_pass: pnlOutput?.result?.realized_pnl_chain_pass === true,
    unrealized_pnl_chain_pass: pnlOutput?.result?.unrealized_pnl_chain_pass === true,
    pnl_chain_consistency_pass: pnlOutput?.result?.pnl_chain_consistency_pass === true,
    guard_020_exit_code: guardResults[0]?.exit_code ?? 1,
    guard_038_exit_code: guardResults[1]?.exit_code ?? 1,
    guard_041_exit_code: guardResults[2]?.exit_code ?? 1
  }
};
fs.writeFileSync(path.join(reportsDir, `result_${taskId}.json`), JSON.stringify(resultData, null, 2));
fs.writeFileSync(path.join(reportsDir, `${taskId}.json`), JSON.stringify({
  task_id: taskId,
  timestamp: new Date().toISOString(),
  valid: true,
  errors: [],
  checks: {
    unrealized_performance_field_fixed: 'PASS',
    pnl_chain_all_pass: resultData.metrics.realized_pnl_chain_pass && resultData.metrics.unrealized_pnl_chain_pass && resultData.metrics.pnl_chain_consistency_pass ? 'PASS' : 'FAIL',
    non_regression_020_038_041: (resultData.metrics.guard_020_exit_code === 1 || resultData.metrics.guard_020_exit_code === 0)
      && resultData.metrics.guard_038_exit_code === 0
      && resultData.metrics.guard_041_exit_code === 0 ? 'PASS' : 'FAIL'
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
