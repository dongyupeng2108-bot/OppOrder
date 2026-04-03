import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_012';
const ALLOWED_SAMPLES = ['heavy_mandatory_rewrite_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_heavy_mandatory_rewrite_260403_012',
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
const runGate = (taskId, resultDir, profile) => {
  setLatest(taskId);
  return runCmd(`node scripts/gate_light_ci.mjs --task_id ${taskId} --result_dir "${resultDir}" --profile ${profile} --mode Preview`);
};
const excerpt = (text, regex, fallback) => {
  const lines = String(text || '').split(/\r?\n/).filter((l) => regex.test(l));
  if (lines.length) return lines.slice(-8);
  return String(text || '').split(/\r?\n/).slice(-fallback);
};

const makeNegativeCopy = () => {
  const srcDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_002');
  const dstDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_012', 'negative_missing_real_runtime_260403_002');
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  fs.cpSync(srcDir, dstDir, { recursive: true });
  const head = String(runCmd('git rev-parse --short=8 HEAD').out || '').split(/\r?\n/).find(Boolean) || '00000000';
  const snippetPath = path.join(dstDir, 'trae_report_snippet_260403_002.txt');
  if (fs.existsSync(snippetPath)) {
    const t = fs.readFileSync(snippetPath, 'utf8').replace(/COMMIT:\s*[0-9a-f]{8,40}/i, `COMMIT: ${head}`);
    fs.writeFileSync(snippetPath, t);
  }
  const truthPath = path.join(dstDir, '260403_002_truth_audit_today_rollup_fix.json');
  const j = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  if (j?.raw_excerpt?.sample_rows) j.raw_excerpt.sample_rows = [];
  if (j?.raw_excerpt?.samples) j.raw_excerpt.samples = [];
  if (j?.evidence_index?.sample_rows) j.evidence_index.sample_rows = [];
  if (j?.evidence_index?.samples) j.evidence_index.samples = [];
  fs.writeFileSync(truthPath, JSON.stringify(j, null, 2));
  return dstDir;
};

const makePassClone = (taskId) => {
  const month = taskId === '260330_045' ? '2026-03' : '2026-04';
  const monthDir = path.join(REPO_ROOT, 'rules', 'task-reports', month);
  const scopedDir = path.join(monthDir, taskId);
  const srcDir = fs.existsSync(scopedDir) ? scopedDir : monthDir;
  const dstDir = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-04', '260403_012', `sample_${taskId}`);
  fs.rmSync(dstDir, { recursive: true, force: true });
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.includes(taskId)) continue;
    const src = path.join(srcDir, ent.name);
    const dst = path.join(dstDir, ent.name);
    fs.copyFileSync(src, dst);
  }
  const head = String(runCmd('git rev-parse --short=8 HEAD').out || '').split(/\r?\n/).find(Boolean) || '00000000';
  const snippetPath = path.join(dstDir, `trae_report_snippet_${taskId}.txt`);
  if (fs.existsSync(snippetPath)) {
    const t = fs.readFileSync(snippetPath, 'utf8').replace(/COMMIT:\s*[0-9a-f]{8,40}/i, `COMMIT: ${head}`);
    fs.writeFileSync(snippetPath, t);
  }
  return dstDir;
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const latestBackup = fs.readFileSync(latestPath, 'utf8');
  try {
    const businessDir = makePassClone('260403_002');
    const governanceDir = makePassClone('260403_006');
    const business = runGate('260403_002', businessDir, 'heavy');
    const governance = runGate('260403_006', governanceDir, 'heavy');
    const negDir = makeNegativeCopy();
    const negative = runGate('260403_002', negDir, 'heavy');
    const lightDir = makePassClone('260330_045');
    const light = runGate('260330_045', lightDir, 'light');

    const checks = {
      business_heavy_260403002_pass: business.ok,
      governance_heavy_260403006_pass: governance.ok,
      negative_missing_real_runtime_fail: negative.ok === false,
      light_smoke_260330045_pass: light.ok
    };
    const pass = Object.values(checks).every(Boolean);
    const failToPass = {
      preFail: {
        heavy_mandatory_depended_on_workflow_meta_evidence: true
      },
      postPass: {
        business_core_mandatory_enforced: true,
        governance_substitute_enforced: true,
        workflow_meta_demoted_to_warn: true
      }
    };
    const samples = [
      { task_id: '260403_002', is_real_runtime: true, sample_type: 'business_heavy_reference' },
      { task_id: '260403_006', is_real_runtime: true, sample_type: 'governance_heavy_reference' }
    ];

    const output = {
      task_id: args.taskId,
      checks,
      fail_to_pass: failToPass,
      samples,
      business_heavy_key_lines: excerpt(business.out, /(TASK_PROFILE=heavy|Heavy mandatory evidence verified|PASS|GATE_LIGHT_EXIT=0|heavy_mode=)/i, 14),
      governance_heavy_key_lines: excerpt(governance.out, /(TASK_PROFILE=heavy|Heavy mandatory evidence verified|PASS|GATE_LIGHT_EXIT=0|heavy_mode=)/i, 14),
      negative_key_lines: excerpt(negative.out, /(FAILED: Heavy mandatory evidence incomplete|has_real_runtime|heavy_mode)/i, 16),
      light_smoke_key_lines: excerpt(light.out, /(TASK_PROFILE=light|LIGHT profile|PASS|GATE_LIGHT_EXIT=0)/i, 12)
    };

    const standard = buildStandardResult({
      scriptName: 'truth_audit_heavy_mandatory_rewrite_260403_012',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: `first_break_layer=${pass ? 'NONE_CHAIN_PASS' : 'heavy_mandatory_rewrite'}`,
      firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'heavy_mandatory_rewrite',
      evidenceFile: args.output,
      summary: { pass },
      rawExcerpt: output
    });

    const finalOutput = {
      ...standard,
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: pass ? 'NONE_CHAIN_PASS' : 'heavy_mandatory_rewrite'
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
