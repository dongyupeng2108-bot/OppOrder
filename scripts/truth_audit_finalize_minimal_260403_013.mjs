import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_013';
const ALLOWED_SAMPLES = ['finalize_minimal_artifacts_v1'];
const DEFAULT_BASE_URL = 'http://localhost:53123';

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: DEFAULT_BASE_URL,
  defaultOutputSuffix: 'truth_audit_finalize_minimal_260403_013',
  defaultSampleName: ALLOWED_SAMPLES[0]
});

const latestPath = path.join(REPO_ROOT, 'rules', 'LATEST.json');
const setLatest = (taskId) => {
  fs.writeFileSync(latestPath, JSON.stringify({
    task_id: taskId,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
  }, null, 4));
};
const runCmd = (command) => {
  const rs = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', command], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  return {
    ok: rs.status === 0,
    code: rs.status ?? 1,
    out: `${rs.stdout || ''}\n${rs.stderr || ''}`.trim()
  };
};
const excerpt = (text, regex, fallback = 16) => {
  const lines = String(text || '').split(/\r?\n/);
  const picks = lines.filter((l) => regex.test(l));
  return picks.length ? picks.slice(-10) : lines.slice(-fallback);
};
const listBasenames = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
};
const writeSnippetHead = (dir, taskId, head) => {
  const snippet = path.join(dir, `trae_report_snippet_${taskId}.txt`);
  if (!fs.existsSync(snippet)) return;
  const next = fs.readFileSync(snippet, 'utf8').replace(/COMMIT:\s*[0-9a-f]{8,40}/i, `COMMIT: ${head}`);
  fs.writeFileSync(snippet, next);
};

const buildSample = (taskId) => {
  const month = taskId === '260330_045' ? '2026-03' : '2026-04';
  const sourceMonthDir = path.join(REPO_ROOT, 'rules', 'task-reports', month);
  const scoped = path.join(sourceMonthDir, taskId);
  const sourceDir = fs.existsSync(scoped) ? scoped : sourceMonthDir;
  const baseOut = path.join(REPO_ROOT, '.tmp', 'finalize_minimal_260403_013');
  const fullDir = path.join(baseOut, `sample_full_${taskId}`);
  const minimalDir = path.join(baseOut, `sample_min_${taskId}`);
  fs.rmSync(fullDir, { recursive: true, force: true });
  fs.rmSync(minimalDir, { recursive: true, force: true });
  fs.mkdirSync(fullDir, { recursive: true });
  fs.mkdirSync(minimalDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.includes(taskId)) continue;
    if (!/truth_audit/i.test(ent.name)) continue;
    const src = path.join(sourceDir, ent.name);
    fs.copyFileSync(src, path.join(fullDir, ent.name));
    fs.copyFileSync(src, path.join(minimalDir, ent.name));
  }
  const head = String(runCmd('git rev-parse --short=8 HEAD').out || '').split(/\r?\n/).find(Boolean) || '00000000';
  writeSnippetHead(fullDir, taskId, head);
  writeSnippetHead(minimalDir, taskId, head);
  return { fullDir, minimalDir };
};

const runFinalizeAndGate = (taskId, profile, dir, artifactMode = null) => {
  setLatest(taskId);
  const modeArg = artifactMode ? ` --artifact_mode ${artifactMode}` : '';
  const finalize = runCmd(`node scripts/finalize_task_evidence.mjs --task_id ${taskId} --result_dir "${dir}" --profile ${profile}${modeArg} --no_stage true`);
  const gate = runCmd(`node scripts/gate_light_ci.mjs --task_id ${taskId} --result_dir "${dir}" --profile ${profile}`);
  return { finalize, gate, ok: finalize.ok && gate.ok };
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const latestBackup = fs.readFileSync(latestPath, 'utf8');
  try {
    const light = buildSample('260330_045');
    const heavyBiz = buildSample('260403_002');
    const heavyGov = buildSample('260403_006');

    const lightFull = runFinalizeAndGate('260330_045', 'light', light.fullDir, 'full');
    const lightMin = runFinalizeAndGate('260330_045', 'light', light.minimalDir, null);
    const bizFull = runFinalizeAndGate('260403_002', 'heavy', heavyBiz.fullDir, 'full');
    const bizMin = runFinalizeAndGate('260403_002', 'heavy', heavyBiz.minimalDir, null);
    const govFull = runFinalizeAndGate('260403_006', 'heavy', heavyGov.fullDir, 'full');
    const govMin = runFinalizeAndGate('260403_006', 'heavy', heavyGov.minimalDir, null);

    const diffLight = listBasenames(light.fullDir).filter((f) => !listBasenames(light.minimalDir).includes(f));
    const diffBiz = listBasenames(heavyBiz.fullDir).filter((f) => !listBasenames(heavyBiz.minimalDir).includes(f));
    const diffGov = listBasenames(heavyGov.fullDir).filter((f) => !listBasenames(heavyGov.minimalDir).includes(f));
    const droppedUnion = Array.from(new Set([...diffLight, ...diffBiz, ...diffGov])).sort();

    const checks = {
      light_minimal_finalize_gate_pass: lightMin.ok,
      heavy_business_minimal_finalize_gate_pass: bizMin.ok,
      heavy_governance_minimal_finalize_gate_pass: govMin.ok,
      full_mode_reference_pass: lightFull.ok && bizFull.ok && govFull.ok,
      diff_contains_trimmed_non_required: droppedUnion.some((f) => /^ci_parity_|^errors_|^errors_summary_|^preflight_attestation_/.test(f)),
      heavy_guards_not_regressed: /SnippetCommitMustMatch verified/i.test(bizMin.gate.out)
        && /Heavy mandatory evidence verified/i.test(bizMin.gate.out)
        && /Healthcheck evidence verified/i.test(bizMin.gate.out)
    };
    const pass = Object.values(checks).every(Boolean);

    const output = {
      checks,
      artifact_diff: {
        light_full_minus_minimal: diffLight,
        heavy_business_full_minus_minimal: diffBiz,
        heavy_governance_full_minus_minimal: diffGov,
        dropped_union: droppedUnion
      },
      key_lines: {
        light_minimal: excerpt(`${lightMin.finalize.out}\n${lightMin.gate.out}`, /(TASK_PROFILE=light|PASS|GATE_LIGHT_EXIT=0|SmokeTest)/i, 20),
        heavy_business_minimal: excerpt(`${bizMin.finalize.out}\n${bizMin.gate.out}`, /(TASK_PROFILE=heavy|Heavy mandatory evidence verified|Healthcheck evidence verified|SnippetCommitMustMatch verified|GATE_LIGHT_EXIT=0|PASS)/i, 24),
        heavy_governance_minimal: excerpt(`${govMin.finalize.out}\n${govMin.gate.out}`, /(TASK_PROFILE=heavy|Heavy mandatory evidence verified|GATE_LIGHT_EXIT=0|PASS)/i, 24),
        before_after_diff: droppedUnion
      }
    };

    const standard = buildStandardResult({
      scriptName: 'truth_audit_finalize_minimal_260403_013',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: `first_break_layer=${pass ? 'NONE_CHAIN_PASS' : 'finalize_minimal_artifacts'}`,
      firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'finalize_minimal_artifacts',
      evidenceFile: args.output,
      summary: { pass },
      rawExcerpt: output
    });
    const finalOutput = {
      ...standard,
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: pass ? 'NONE_CHAIN_PASS' : 'finalize_minimal_artifacts'
      },
      evidence_index: output
    };
    ensureDir(args.output);
    fs.writeFileSync(args.output, JSON.stringify(finalOutput, null, 2));
    const verifyLog = writeStandardLog(args.output, standard);
    console.log(`VERIFY_OUTPUT=${args.output}`);
    console.log(`VERIFY_LOG=${verifyLog}`);
    console.log(JSON.stringify({ pass, checks }));
    if (!pass) process.exit(1);
  } finally {
    fs.writeFileSync(latestPath, latestBackup);
  }
};

main().catch((error) => {
  console.error(JSON.stringify({ event: 'AUDIT_FATAL', code: error?.message || 'ERR_UNHANDLED', allowed_samples: ALLOWED_SAMPLES }));
  process.exit(1);
});
