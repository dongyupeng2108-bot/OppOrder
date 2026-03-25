import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260324_033';

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
  const output = args.output || path.join(REPO_ROOT, 'rules', 'task-reports', month, `${taskId}_verify_all_manual.json`);
  const simulateFail = args.simulate_fail === 'true' || process.env.VERIFY_ALL_FORCE_FAIL === '1';
  return { taskId, output, simulateFail };
};

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const verifyTargets = [
  { script: 'verify_btc_source_chain.mjs', suffix: 'btc_source_chain', sample: 'real_no_debug+debug_main_path_v1' },
  { script: 'verify_context_truth.mjs', suffix: 'context_truth', sample: 'debug_main_path_v1+debug_fill_yes_path_v1' },
  { script: 'verify_window_lifecycle.mjs', suffix: 'window_lifecycle', sample: 'debug_main_path_v1+real_no_debug' },
  { script: 'verify_executor_idempotency.mjs', suffix: 'executor_idempotency', sample: 'debug_main_path_v1+debug_fill_yes_path_v1' },
  { script: 'verify_result_chain_consistency.mjs', suffix: 'result_chain_consistency', sample: 'debug_fill_yes_path_v1' },
  { script: 'verify_order_scope_and_status.mjs', suffix: 'order_scope_and_status', sample: 'debug_fill_yes_path_v1' },
  { script: 'verify_pnl_chain_consistency.mjs', suffix: 'pnl_chain_consistency', sample: 'debug_exit_yes_path_v1+debug_fill_yes_path_v1' },
  { script: 'verify_config_effect_chain.mjs', suffix: 'config_effect_chain', sample: 'debug_main_path_v1+debug_fill_yes_path_v1+real_no_debug' }
];

const runVerify = ({ script, sample, suffix }, taskId, reportsDir) => {
  const commandArgs = [`scripts/${script}`, `--task_id=${taskId}`, `--sample=${sample}`];
  const result = spawnSync(process.execPath, commandArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  const evidenceFile = path.join(reportsDir, `${taskId}_${suffix}.json`);
  let parsed = null;
  if (fs.existsSync(evidenceFile)) {
    try {
      parsed = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    } catch {}
  }
  return {
    script_name: parsed?.script_name || script.replace('.mjs', ''),
    pass: parsed?.pass === true && result.status === 0,
    message: parsed?.message || (result.status === 0 ? 'PASS' : 'FAIL'),
    evidence_file: parsed?.evidence_file || evidenceFile,
    exit_code: result.status ?? 1,
    sample_name: parsed?.sample_name || sample
  };
};

const writeLog = (logPath, payload) => {
  const lines = [
    `task_id=${payload.task_id}`,
    `overall_pass=${payload.overall_pass}`,
    `total=${payload.total_scripts}`,
    `pass_count=${payload.pass_count}`,
    `fail_count=${payload.fail_count}`,
    ...payload.results.map((item) => `${item.script_name}|pass=${item.pass}|message=${item.message}|evidence=${item.evidence_file}`)
  ];
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
};

const main = () => {
  const args = parseArgs();
  ensureDir(args.output);
  const reportsDir = path.dirname(args.output);
  const results = verifyTargets.map((target) => runVerify(target, args.taskId, reportsDir));
  const passCountRaw = results.filter((item) => item.pass).length;
  const resultsFinal = args.simulateFail
    ? [...results, {
      script_name: 'forced_failure_probe',
      pass: false,
      message: 'forced failure for runner state-flow verification',
      evidence_file: args.output,
      exit_code: 1,
      sample_name: 'forced_failure'
    }]
    : results;
  const passCount = resultsFinal.filter((item) => item.pass).length;
  const output = {
    script_name: 'verify_all_manual',
    task_id: args.taskId,
    total_scripts: resultsFinal.length,
    pass_count: passCount,
    fail_count: resultsFinal.length - passCount,
    overall_pass: passCount === resultsFinal.length,
    results: resultsFinal,
    simulated_failure: args.simulateFail,
    raw_pass_count: passCountRaw,
    generated_at: new Date().toISOString()
  };
  const logPath = args.output.replace(/\.json$/i, '.log');
  fs.writeFileSync(args.output, JSON.stringify(output, null, 2));
  writeLog(logPath, output);
  console.log(`VERIFY_ALL_OUTPUT=${args.output}`);
  console.log(`VERIFY_ALL_LOG=${logPath}`);
  console.log(JSON.stringify({ overall_pass: output.overall_pass, pass_count: output.pass_count, fail_count: output.fail_count }));
  if (!output.overall_pass) process.exitCode = 1;
};

main();
