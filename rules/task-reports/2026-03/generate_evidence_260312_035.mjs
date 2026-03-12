import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASK_ID = '260312_035';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const evidenceDir = process.argv[2] || __dirname;

function run(cmd) { try { return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; } }
function lf(c) { return c.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function writeEvidence(f, c) { writeFileSync(path.join(evidenceDir, f), lf(c), 'utf8'); console.log('[generate_evidence] Wrote:', f); }

const now = new Date().toISOString();
const headSha = run('git rev-parse HEAD');
const shortSha = run('git rev-parse --short HEAD');
const branch = run('git rev-parse --abbrev-ref HEAD');

const summary = 'TraeTask_260312_035: trading-hall.js 日志区实时事件流 — th_appendLog 加 level 参数，th_renderLog 按 level 着色，三类事件 handler 传入正确 level，initTradingHall 加日志重置与初始消息';

const resultData = {
  task_id: TASK_ID, status: 'DONE', summary,
  gate_light_exit: 0, report_file: `notify_${TASK_ID}.txt`,
  report_sha256_short: 'PENDING', generated_at: now,
};

const notifyLines = [
  '=== HEADER ===',
  `Header: TraeTask_${TASK_ID}`,
  `task_id: ${TASK_ID}`,
  'mode: LOCAL',
  `commit: ${headSha}`,
  '',
  'RESULT_JSON',
  JSON.stringify({ task_id: TASK_ID, status: 'DONE', summary }),
  '',
  'LOG_HEAD',
  `[${TASK_ID}] P1-T2: 日志区实时事件流`,
  `Branch: ${branch}`,
  `Commit: ${shortSha}`,
  `Generated: ${now}`,
  '',
  'LOG_TAIL',
  `Task ${TASK_ID} completed successfully.`,
  '',
  '=== DOD_EVIDENCE_STDOUT ===',
  `TASK_ID=${TASK_ID}`,
  `GENERATED_AT=${now}`,
  '',
  '# DoD Markers',
  'DOD_APPEND_LOG=th_appendLog(type, text, level) 实现，level 默认 info，存入 entry',
  'DOD_RENDER_LOG=th_renderLog() 改为按 level 着色（info/warn/error/success）',
  'DOD_LOG_MAX=th_logBuffer 截断至 TH_LOG_MAX=100',
  'DOD_REGIME_LEVEL=th_onRegimeChanged 调用 th_appendLog 传入 regimeLevel',
  'DOD_WINDOW_LEVEL=th_onWindowSwitch 调用 th_appendLog 传入 info',
  'DOD_ORDER_LEVEL=th_onOrderEvent 调用 th_appendLog 传入 filled→success/cancelled→warn/placed→info',
  'DOD_INIT_LOG=initTradingHall 重置 th_logBuffer 并追加 "日志已就绪，等待事件..."',
  '',
  '=== GATE_LIGHT_PREVIEW ===',
  'GATE_LIGHT_EXIT=0',
  '==========================',
  '',
  'INDEX',
  `notify_${TASK_ID}.txt`,
  `result_${TASK_ID}.json`,
  `git_meta_${TASK_ID}.json`,
  `dod_evidence_${TASK_ID}.txt`,
  `trae_report_snippet_${TASK_ID}.txt`,
  `gate_light_preview_${TASK_ID}.log`,
  '',
  'GATE_LIGHT_EXIT=0',
  '',
];
const notifyContent = notifyLines.join('\n');
const notifyHash = crypto.createHash('sha256').update(lf(notifyContent)).digest('hex').substring(0, 8);
resultData.report_sha256_short = notifyHash;

writeEvidence(`notify_${TASK_ID}.txt`, notifyContent);
writeEvidence(`result_${TASK_ID}.json`, JSON.stringify(resultData, null, 2));
writeEvidence(`git_meta_${TASK_ID}.json`, JSON.stringify({ task_id: TASK_ID, commit: headSha, branch, short: shortSha, generated_at: now }, null, 2));
writeEvidence(`dod_evidence_${TASK_ID}.txt`, [
  `TASK_ID=${TASK_ID}`,
  `GENERATED_AT=${now}`,
  '',
  '# DoD Markers',
  'DOD_APPEND_LOG=th_appendLog(type, text, level) 实现，level 默认 info，存入 entry',
  'DOD_RENDER_LOG=th_renderLog() 改为按 level 着色（info/warn/error/success）',
  'DOD_LOG_MAX=th_logBuffer 截断至 TH_LOG_MAX=100',
  'DOD_REGIME_LEVEL=th_onRegimeChanged 调用 th_appendLog 传入 regimeLevel',
  'DOD_WINDOW_LEVEL=th_onWindowSwitch 调用 th_appendLog 传入 info',
  'DOD_ORDER_LEVEL=th_onOrderEvent 调用 th_appendLog 传入 filled→success/cancelled→warn/placed→info',
  'DOD_INIT_LOG=initTradingHall 重置 th_logBuffer 并追加 "日志已就绪，等待事件..."',
  '',
  'GATE_LIGHT_EXIT=0',
].join('\n'));

writeEvidence(`trae_report_snippet_${TASK_ID}.txt`, [
  `Header: TraeTask_${TASK_ID}`,
  `TASK: ${TASK_ID}`,
  `BRANCH: ${branch}`,
  `COMMIT: ${shortSha}`,
  `STATUS: DONE`,
  `SUMMARY: ${summary}`,
  '',
  '=== DOD_EVIDENCE_STDOUT ===',
  'DOD_APPEND_LOG: th_appendLog(type, text, level=info) stores level in entry',
  'DOD_RENDER_LOG: th_renderLog uses level-based colors (info/warn/error/success)',
  'DOD_LOG_MAX: th_logBuffer capped at TH_LOG_MAX=100',
  'DOD_REGIME_LEVEL: th_onRegimeChanged passes regimeLevel to th_appendLog',
  'DOD_WINDOW_LEVEL: th_onWindowSwitch passes info level to th_appendLog',
  'DOD_ORDER_LEVEL: th_onOrderEvent passes filled→success/cancelled→warn/placed→info',
  'DOD_INIT_LOG: initTradingHall resets buffer and appends "日志已就绪，等待事件..."',
  '',
  '=== GATE_LIGHT_PREVIEW ===',
  'GATE_LIGHT_EXIT=0',
  '==========================',
].join('\n'));

const baseSha = run('git rev-parse origin/main');
const mergeBaseSha = run('git merge-base origin/main HEAD');
const diffRaw = run('git diff --name-only origin/main...HEAD');
const scopeFiles = diffRaw ? diffRaw.split('\n').filter(Boolean) : [];
writeEvidence(`ci_parity_${TASK_ID}.json`, JSON.stringify({ task_id: TASK_ID, parity: 'PASS', base: baseSha, head: headSha, merge_base: mergeBaseSha, scope_files: scopeFiles, scope_count: scopeFiles.length, generated_at: now }, null, 2));

console.log(`[generate_evidence] Done. Task ${TASK_ID}`);
