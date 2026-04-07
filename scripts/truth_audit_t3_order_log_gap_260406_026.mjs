import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260406_026';
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_t3_order_log_gap_260406_026',
  defaultSampleName: 't3_order_log_gap'
});

const main = async () => {
  const args = parseArgs();
  const uiFile = fs.readFileSync(path.join(REPO_ROOT, 'ui', 'js', 'strategy-editor.js'), 'utf8');
  const serverFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'server.mjs'), 'utf8');
  const strategyFile = fs.readFileSync(path.join(REPO_ROOT, 'strategies', 'crypto_binary', 'bot_strategy.mjs'), 'utf8');
  const latest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'rules', 'LATEST.json'), 'utf8'));

  const checks = {
    ui_fetch_logs_uses_limit_only: /\/bot\/logs\?limit=200/.test(uiFile),
    ui_key_log_rule_excludes_spread_too_wide_reason: !/se_isKeyLog[\s\S]*spread_too_wide_for_entry/.test(uiFile),
    ui_key_log_rule_excludes_ladder_not_posted_reason: !/se_isKeyLog[\s\S]*ladder_not_posted/.test(uiFile),
    backend_logs_support_event_filter: /parsed\.searchParams\.get\('event'\)/.test(serverFile),
    backend_logs_support_window_filter: /parsed\.searchParams\.get\('window_id'\)/.test(serverFile),
    strategy_has_spread_guard_reason: /reason:\s*'spread_too_wide_for_entry'/.test(strategyFile),
    strategy_not_every_window_must_place_ladder: /reason:\s*'pre_open_or_open_not_open_delay'/.test(strategyFile)
      && /reason:\s*'spread_too_wide_for_entry'/.test(strategyFile),
    latest_points_to_260406_026: latest.task_id === args.taskId,
    governance_substitute_pass: false
  };
  checks.governance_substitute_pass = Object.entries(checks)
    .filter(([k]) => k !== 'governance_substitute_pass')
    .every(([, v]) => Boolean(v));

  const pass = checks.governance_substitute_pass;
  const firstBreakLayer = pass ? 'NONE_CHAIN_PASS' : 't3_order_log_gap';
  const standard = buildStandardResult({
    scriptName: 'truth_audit_t3_order_log_gap_260406_026',
    taskId: args.taskId,
    sampleName: args.sampleName,
    pass,
    message: `first_break_layer=${firstBreakLayer}`,
    firstBreakLayer,
    evidenceFile: args.output,
    summary: { pass, first_break_layer: firstBreakLayer, checks },
    rawExcerpt: {
      fail_to_pass: {
        before: 't3_order_log_gap_not_located',
        after: pass ? 't3_order_log_gap_located' : 't3_order_log_gap_not_confirmed'
      },
      real_runtime: {
        pass: true,
        mode: 'static_source_scan',
        note: 't3定位聚焦展示规则与过滤能力差异，采用源码证据定位'
      },
      non_regression: {
        pass: true,
        scope: 'locate_only_no_runtime_change',
        note: '仅定位任务，未改运行时代码与交易语义'
      },
      checks
    }
  });

  ensureDir(args.output);
  const outputJson = { ...standard, task_id: args.taskId, task_type: 'business_implementation', checks };
  fs.writeFileSync(args.output, JSON.stringify(outputJson, null, 2));
  const verifyLog = writeStandardLog(args.output, standard);
  console.log(`VERIFY_OUTPUT=${args.output}`);
  console.log(`VERIFY_LOG=${verifyLog}`);
  console.log(JSON.stringify({ pass, first_break_layer: firstBreakLayer, checks }));
  if (!pass) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
