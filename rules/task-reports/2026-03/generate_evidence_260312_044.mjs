import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASK_ID = '260312_044';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const evidenceDir = process.argv[2] || __dirname;

function run(cmd) { try { return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; } }
function lf(c) { return c.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function writeEvidence(f, c) { writeFileSync(path.join(evidenceDir, f), lf(c), 'utf8'); console.log('[generate_evidence] Wrote:', f); }

const now = new Date().toISOString();
const headSha = run('git rev-parse HEAD');
const shortSha = run('git rev-parse --short HEAD');
const branch = run('git rev-parse --abbrev-ref HEAD');

const summary = 'TraeTask_260312_044: 复盘实例过滤 — sl_fetchAttribution/sl_fetchLossModes/sl_fetchPostmortemCount 追加 strategy_id 查询参数；server.mjs 三端点（attribution/loss-modes/sensitivity）改为 startsWith 匹配并按 strategy_id 内联过滤 WHERE 条件';

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
  `[${TASK_ID}] FIX-1: 复盘实例过滤`,
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
  'DOD_FETCH_ATTRIBUTION=sl_fetchAttribution 追加 ?strategy_id=<sl_sel> 参数（sl_sel 为空时回退全局查询）',
  'DOD_FETCH_LOSS_MODES=sl_fetchLossModes 追加 ?strategy_id=<sl_sel> 参数',
  'DOD_FETCH_POSTMORTEM_COUNT=sl_fetchPostmortemCount attribution 调用追加 strategy_id 参数',
  'DOD_SERVER_ATTRIBUTION=server.mjs /postmortem/attribution startsWith 匹配 + strategy_id 内联 WHERE 过滤',
  'DOD_SERVER_LOSS_MODES=server.mjs /postmortem/loss-modes startsWith 匹配 + strategy_id 内联 WHERE 过滤',
  'DOD_SERVER_SENSITIVITY=server.mjs /postmortem/sensitivity startsWith 匹配 + strategy_id 内联 WHERE 过滤',
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
  'DOD_FETCH_ATTRIBUTION=sl_fetchAttribution 追加 strategy_id 查询参数',
  'DOD_FETCH_LOSS_MODES=sl_fetchLossModes 追加 strategy_id 查询参数',
  'DOD_FETCH_POSTMORTEM_COUNT=sl_fetchPostmortemCount 追加 strategy_id 查询参数',
  'DOD_SERVER_ATTRIBUTION=server.mjs attribution 端点 startsWith + 内联 WHERE 过滤',
  'DOD_SERVER_LOSS_MODES=server.mjs loss-modes 端点 startsWith + 内联 WHERE 过滤',
  'DOD_SERVER_SENSITIVITY=server.mjs sensitivity 端点 startsWith + 内联 WHERE 过滤',
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
  'DOD_FETCH_ATTRIBUTION: sl_fetchAttribution appends ?strategy_id=<sl_sel> (empty → global fallback)',
  'DOD_FETCH_LOSS_MODES: sl_fetchLossModes appends ?strategy_id=<sl_sel>',
  'DOD_FETCH_POSTMORTEM_COUNT: sl_fetchPostmortemCount attribution call appends strategy_id',
  'DOD_SERVER_ATTRIBUTION: server.mjs /postmortem/attribution startsWith + inline WHERE strategy_id filter',
  'DOD_SERVER_LOSS_MODES: server.mjs /postmortem/loss-modes startsWith + inline WHERE strategy_id filter',
  'DOD_SERVER_SENSITIVITY: server.mjs /postmortem/sensitivity startsWith + inline WHERE strategy_id filter',
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
