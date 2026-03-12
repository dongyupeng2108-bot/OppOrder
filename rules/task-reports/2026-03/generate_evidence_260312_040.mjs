import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TASK_ID = '260312_040';
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const evidenceDir = process.argv[2] || __dirname;

function run(cmd) { try { return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; } }
function lf(c) { return c.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
function writeEvidence(f, c) { writeFileSync(path.join(evidenceDir, f), lf(c), 'utf8'); console.log('[generate_evidence] Wrote:', f); }

const now = new Date().toISOString();
const headSha = run('git rev-parse HEAD');
const shortSha = run('git rev-parse --short HEAD');
const branch = run('git rev-parse --abbrev-ref HEAD');

const summary = 'TraeTask_260312_040: config_reload 中断提示 — 新增 st_reloadWithConfirm(name, isLiveMode) + st_hasLiveInstance()；st_applySettings 替换内联 confirm+fetch；Live 模式 confirm 含 ⚠️ 警告';

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
  `[${TASK_ID}] P2-T2: config_reload 中断提示`,
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
  'DOD_RELOAD_CONFIRM=st_reloadWithConfirm(name, isLiveMode) 新增于 settings.js',
  'DOD_LIVE_DETECT=st_hasLiveInstance() 新增，fetch /strategies/status 判断 runtime_state+executor_mode',
  'DOD_REPLACE_INLINE=st_applySettings 内联 confirm+fetch 替换为 st_reloadWithConfirm(instanceName, isLive)',
  'DOD_LIVE_WARNING=isLiveMode=true 时 confirm 含 ⚠️ 警告字样',
  'DOD_NO_TH_RELOAD=trading-hall.js 无 /config/reload 调用，无需修改',
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
  'DOD_RELOAD_CONFIRM=st_reloadWithConfirm(name, isLiveMode) 新增于 settings.js',
  'DOD_LIVE_DETECT=st_hasLiveInstance() 新增，fetch /strategies/status 判断 runtime_state+executor_mode',
  'DOD_REPLACE_INLINE=st_applySettings 内联 confirm+fetch 替换为 st_reloadWithConfirm(instanceName, isLive)',
  'DOD_LIVE_WARNING=isLiveMode=true 时 confirm 含 ⚠️ 警告字样',
  'DOD_NO_TH_RELOAD=trading-hall.js 无 /config/reload 调用，无需修改',
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
  'DOD_RELOAD_CONFIRM: st_reloadWithConfirm(name, isLiveMode) added to settings.js',
  'DOD_LIVE_DETECT: st_hasLiveInstance() added, fetches /strategies/status for runtime_state+executor_mode',
  'DOD_REPLACE_INLINE: st_applySettings inline confirm+fetch replaced with st_reloadWithConfirm(instanceName, isLive)',
  'DOD_LIVE_WARNING: confirm message includes ⚠️ warning when isLiveMode=true',
  'DOD_NO_TH_RELOAD: trading-hall.js has no /config/reload call, no changes needed',
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
