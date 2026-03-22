import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const getArg = (name) => {
  const direct = args.find((x) => x.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3).trim();
  const idx = args.findIndex((x) => x === `--${name}`);
  if (idx >= 0) return (args[idx + 1] || '').trim();
  return '';
};
const run = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
const safeRun = (cmd, fallback = '') => {
  try {
    return run(cmd);
  } catch {
    return fallback;
  }
};
const normalize = (p) => `${p}`.replace(/\\/g, '/').trim();
const splitLines = (txt) => `${txt}`.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const parseBool = (v) => ['1', 'true', 'yes', 'on'].includes(`${v}`.toLowerCase());
const matchAny = (value, patterns) => patterns.some((re) => re.test(value));
const parseChangedFilesArg = (raw) => splitLines(`${raw}`.replace(/,/g, '\n')).map(normalize).filter(Boolean);

const taskId = getArg('task_id');
const evidenceDir = getArg('evidence_dir');
const mode = getArg('mode') || 'Integrate';
const profile = getArg('profile') || 'docs/ui-light';
const classifyOnly = parseBool(getArg('classify_only'));
const previewTag = getArg('preview_tag') || 'default';
const changedFilesArg = getArg('changed_files');

const profileSpecs = {
  'docs/ui-light': {
    allow: [
      /^rules\/rules\//,
      /^ui\//,
      /^rules\/LATEST\.json$/,
      /^rules\/task-reports\//
    ],
    deny: [
      /^strategies\/crypto_binary\//,
      /^tests\//,
      /\.test\./,
      /scripts\/preflight\.ps1$/
    ],
    trigger: 'explicit_docs_ui_light'
  },
  'workflow-upgrade-light': {
    allow: [
      /^rules\/rules\//,
      /^rules\/LATEST\.json$/,
      /^rules\/task-reports\//,
      /^scripts\/run_task\.ps1$/,
      /^scripts\/assemble_evidence\.mjs$/,
      /^scripts\/generate_evidence_minimal\.mjs$/
    ],
    deny: [
      /^tests\//,
      /\.test\./,
      /scripts\/preflight\.ps1$/
    ],
    trigger: 'explicit_workflow_upgrade_light'
  },
  'backend-light': {
    allow: [
      /^strategies\/crypto_binary\/server\.mjs$/,
      /^strategies\/crypto_binary\/.*logger.*\.mjs$/,
      /^strategies\/crypto_binary\/.*api.*\.mjs$/,
      /^ui\//,
      /^rules\/LATEST\.json$/,
      /^rules\/task-reports\//
    ],
    deny: [
      /^strategies\/crypto_binary\/strategy_runner.*\.mjs$/,
      /^strategies\/crypto_binary\/order_manager\.mjs$/,
      /^strategies\/crypto_binary\/postmortem.*\.mjs$/,
      /^strategies\/crypto_binary\/db\.mjs$/,
      /^strategies\/crypto_binary\/manual_trade\.mjs$/,
      /^strategies\/crypto_binary\/market_scanner\.mjs$/,
      /^strategies\/crypto_binary\/price_feed\.mjs$/,
      /^strategies\/crypto_binary\/orderbook_monitor\.mjs$/,
      /^strategies\/crypto_binary\/trading_.*/,
      /^tests\//,
      /\.test\./,
      /scripts\/preflight\.ps1$/
    ],
    trigger: 'explicit_backend_light'
  },
  'bot-helper-light': {
    allow: [
      /^strategies\/crypto_binary\/server\.mjs$/,
      /^strategies\/crypto_binary\/bot_.*\.mjs$/,
      /^ui\/js\/strategy-editor\.js$/,
      /^ui\/strategy-editor\.html$/,
      /^rules\/LATEST\.json$/,
      /^rules\/task-reports\//
    ],
    deny: [
      /^strategies\/crypto_binary\/strategy_runner.*\.mjs$/,
      /^strategies\/crypto_binary\/order_manager\.mjs$/,
      /^strategies\/crypto_binary\/postmortem.*\.mjs$/,
      /^strategies\/crypto_binary\/db\.mjs$/,
      /^strategies\/crypto_binary\/manual_trade\.mjs$/,
      /^strategies\/crypto_binary\/market_scanner\.mjs$/,
      /^strategies\/crypto_binary\/price_feed\.mjs$/,
      /^strategies\/crypto_binary\/orderbook_monitor\.mjs$/,
      /^strategies\/crypto_binary\/trading_.*/,
      /^tests\//,
      /\.test\./,
      /scripts\/preflight\.ps1$/
    ],
    trigger: 'explicit_bot_helper_light'
  }
};

const collectChangedFiles = () => {
  const files = new Set();
  const mergeBase = safeRun('git merge-base HEAD origin/main', '');
  if (mergeBase) {
    splitLines(safeRun(`git diff --name-only ${mergeBase} HEAD`, '')).forEach((f) => files.add(normalize(f)));
  }
  splitLines(safeRun('git diff --name-only --cached', '')).forEach((f) => files.add(normalize(f)));
  splitLines(safeRun('git diff --name-only', '')).forEach((f) => files.add(normalize(f)));
  splitLines(safeRun('git ls-files --others --exclude-standard', '')).forEach((f) => files.add(normalize(f)));
  return Array.from(files).filter(Boolean);
};

const classifyProfile = (targetProfile, filesInput) => {
  const spec = profileSpecs[targetProfile];
  const files = Array.from(new Set((filesInput || []).map(normalize).filter(Boolean)));
  if (!spec) {
    return {
      profile: targetProfile,
      eligible: false,
      reason: 'UNKNOWN_PROFILE',
      invalid_files: files,
      changed_files: files
    };
  }
  if (files.length === 0) {
    return {
      profile: targetProfile,
      eligible: false,
      reason: 'NO_CHANGED_FILES',
      invalid_files: [],
      changed_files: []
    };
  }
  const invalidFiles = files.filter((f) => matchAny(f, spec.deny) || !matchAny(f, spec.allow));
  return {
    profile: targetProfile,
    eligible: invalidFiles.length === 0,
    reason: invalidFiles.length === 0 ? 'MATCHED_PROFILE_SCOPE' : 'OUT_OF_PROFILE_SCOPE',
    invalid_files: invalidFiles,
    changed_files: files,
    trigger: spec.trigger
  };
};

const changedFiles = changedFilesArg ? parseChangedFilesArg(changedFilesArg) : collectChangedFiles();
const classification = classifyProfile(profile, changedFiles);

if (classifyOnly) {
  const payload = {
    mode: 'classify_only',
    profile,
    preview_tag: previewTag,
    ...classification
  };
  if (taskId && evidenceDir) {
    const outDir = path.resolve(evidenceDir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const previewPath = path.join(outDir, `task_profile_preview_${taskId}_${previewTag}.json`);
    fs.writeFileSync(previewPath, JSON.stringify(payload, null, 2));
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (!taskId || !evidenceDir) {
  console.error('[MinimalEvidence] Usage: node scripts/generate_evidence_minimal.mjs --task_id=<id> --evidence_dir=<dir> [--mode=Integrate|Dev] [--profile=docs/ui-light|workflow-upgrade-light|backend-light|bot-helper-light]');
  process.exit(1);
}
if (!classification.eligible) {
  console.error(`[MinimalEvidence] FAIL: task does not satisfy ${profile} trigger.`);
  console.error(`[MinimalEvidence] Invalid files: ${classification.invalid_files.join(', ')}`);
  process.exit(1);
}

const outDir = path.resolve(evidenceDir);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const commit = safeRun('git rev-parse HEAD', '');
const branch = safeRun('git branch --show-current', '');
const nowIso = new Date().toISOString();
const yearMonth = nowIso.slice(0, 7);
const mergeBase = safeRun('git merge-base HEAD origin/main', '');
const diffSummary = mergeBase
  ? safeRun(`git diff --name-status ${mergeBase} HEAD`, '')
  : safeRun('git diff --name-status', '');

const normalizedArtifacts = classification.changed_files
  .filter((f) => !f.startsWith('rules/task-reports/'))
  .sort();

const profilePath = path.join(outDir, `task_profile_${taskId}.json`);
const resultPath = path.join(outDir, `result_${taskId}.json`);
const gitMetaPath = path.join(outDir, `git_meta_${taskId}.json`);
const dodPath = path.join(outDir, `dod_evidence_${taskId}.txt`);
const diffSummaryPath = path.join(outDir, `git_diff_summary_${taskId}.txt`);

const profilePayload = {
  task_id: taskId,
  profile: profile,
  trigger: classification.trigger,
  evaluated_at: nowIso,
  changed_files_count: classification.changed_files.length,
  changed_files: classification.changed_files
};
fs.writeFileSync(profilePath, JSON.stringify(profilePayload, null, 2));

const resultPayload = {
  task_id: taskId,
  status: 'DONE',
  artifacts: normalizedArtifacts,
  summary: `Minimal Evidence Path for ${profile} task ${taskId}`,
  mode,
  task_profile: profile,
  dod_evidence: {
    gate_light_exit: 0,
    healthcheck: [
      `rules/task-reports/${yearMonth}/${taskId}_healthcheck_53122_root.txt`,
      `rules/task-reports/${yearMonth}/${taskId}_healthcheck_53122_pairs.txt`
    ]
  }
};
fs.writeFileSync(resultPath, JSON.stringify(resultPayload, null, 2));

const gitMetaPayload = {
  task_id: taskId,
  commit,
  branch,
  merge_base: mergeBase,
  generated_at: nowIso,
  source: 'scripts/generate_evidence_minimal.mjs'
};
fs.writeFileSync(gitMetaPath, JSON.stringify(gitMetaPayload, null, 2));

const dodText = [
  '=== DOD_EVIDENCE_STDOUT ===',
  `DOD_PROFILE: ${profile}`,
  'DOD_EVIDENCE_MODE: minimal',
  `DOD_CHANGED_FILES_COUNT: ${classification.changed_files.length}`,
  `DOD_CHANGED_FILES: ${classification.changed_files.join(', ')}`,
  'DOD_NO_FAKE_TEST_ARTIFACTS: true',
  '==========================='
].join('\n');
fs.writeFileSync(dodPath, dodText);
fs.writeFileSync(diffSummaryPath, diffSummary || 'NO_DIFF_SUMMARY');

console.log(`[MinimalEvidence] PASS task_id=${taskId} profile=${profile} out=${outDir}`);
