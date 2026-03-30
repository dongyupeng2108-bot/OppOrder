import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260328_036';

const parseArgs = () => {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((item) => item.startsWith('--'))
      .map((item) => {
        const [k, ...rest] = item.slice(2).split('=');
        return [k, rest.join('=') || 'true'];
      })
  );
  const taskId = args.task_id || DEFAULT_TASK_ID;
  const month = new Date().toISOString().slice(0, 7);
  const output = args.output || path.join(REPO_ROOT, 'rules', 'task-reports', month, `${taskId}_module1_strategy_input.json`);
  return { taskId, output };
};

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const readJsonSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const subTests = [
  {
    name: 'verify_strategy_runtime_regression_guard',
    script: 'verify_strategy_runtime_regression_guard.mjs',
    sample: 'real_runtime_regression_guard_v1',
    evidenceSuffix: 'strategy_runtime_regression_guard'
  },
  {
    name: 'truth_audit_recovery_persistence',
    script: 'truth_audit_recovery_persistence_260328_031.mjs',
    sample: 'fail_to_pass_recovery_fix',
    evidenceSuffix: 'truth_audit_recovery_persistence'
  },
  {
    name: 'truth_audit_formula_engine_fix',
    script: 'truth_audit_formula_engine_fix_260328_034.mjs',
    sample: 'dangerous_expr_fix+isolation+runtime_perf',
    evidenceSuffix: 'truth_audit_formula_engine_fix'
  },
  {
    name: 'truth_audit_observability_consistency',
    script: 'truth_audit_observability_consistency_260328_035.mjs',
    sample: 'reason_intents_summary_evidence_consistency_v1',
    evidenceSuffix: 'truth_audit_observability_consistency'
  },
  {
    name: 'verify_module1_golden_scenarios_v1',
    script: 'verify_module1_golden_scenarios_v1.mjs',
    sample: 'module1_golden_scenarios_v1',
    evidenceSuffix: 'module1_golden_scenarios_v1'
  }
];

const module1CoverageChecklist = [
  '新契约保存/读取与生效语义',
  '预览/runtime 一致性',
  'UP/DOWN 独立梯队',
  '逐档 tp_price 绑定',
  '方向撤单隔离',
  '撤单优先级 / 非 PLACE_LADDER 禁新增 / 防抖 / 去重（关键项）',
  '窗口边界与状态重置',
  '恢复能力与持久化一致性',
  '公式白名单与危险表达式边界',
  '观测与证据一致性',
  'Owner 黄金场景回归包 v1（4 场景）'
];

const runSubTest = ({ script, sample, evidenceSuffix, name }, taskId, reportsDir) => {
  const result = spawnSync(process.execPath, [`scripts/${script}`, `--task_id=${taskId}`, `--sample=${sample}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  const fallbackEvidence = path.join(reportsDir, `${taskId}_${evidenceSuffix}.json`);
  const parsed = readJsonSafe(fallbackEvidence);
  const pass = result.status === 0 && (parsed?.pass !== false);
  return {
    script_name: name,
    entry: `scripts/${script}`,
    sample_name: sample,
    pass,
    exit_code: result.status ?? 1,
    message: parsed?.message || (pass ? 'PASS' : 'FAIL'),
    evidence_file: parsed?.evidence_file || fallbackEvidence
  };
};

const writeLog = (logPath, payload) => {
  const lines = [
    `task_id=${payload.task_id}`,
    `overall_pass=${payload.overall_pass}`,
    `module=module1`,
    ...payload.results.map((item) => `${item.script_name}|pass=${item.pass}|sample=${item.sample_name}|evidence=${item.evidence_file}`)
  ];
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
};

const main = () => {
  const args = parseArgs();
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const results = subTests.map((item) => runSubTest(item, args.taskId, reportsDir));
  const passCount = results.filter((item) => item.pass).length;
  const output = {
    script_name: 'verify_module1_strategy_input',
    task_id: args.taskId,
    module_key: 'module1',
    pass: passCount === results.length,
    total_scripts: results.length,
    pass_count: passCount,
    fail_count: results.length - passCount,
    overall_pass: passCount === results.length,
    coverage_checklist: module1CoverageChecklist,
    results,
    generated_at: new Date().toISOString()
  };
  const logPath = args.output.replace(/\.json$/i, '.log');
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  writeLog(logPath, output);
  console.log(`VERIFY_MODULE1_OUTPUT=${args.output}`);
  console.log(`VERIFY_MODULE1_LOG=${logPath}`);
  console.log(JSON.stringify({ overall_pass: output.overall_pass, pass_count: output.pass_count, fail_count: output.fail_count }));
  if (!output.overall_pass) process.exitCode = 1;
};

main();
