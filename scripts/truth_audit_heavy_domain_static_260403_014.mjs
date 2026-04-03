import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildStandardResult, ensureDir, parseVerifyArgs, writeStandardLog } from './verify_standard_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TASK_ID = '260403_014';
const ALLOWED_SAMPLES = ['heavy_domain_static_v1'];

const parseArgs = () => parseVerifyArgs({
  defaultTaskId: DEFAULT_TASK_ID,
  defaultBaseUrl: 'http://localhost:53123',
  defaultOutputSuffix: 'truth_audit_heavy_domain_static_260403_014',
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
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    ok: rs.status === 0,
    code: rs.status ?? 1,
    out: `${rs.stdout || ''}\n${rs.stderr || ''}`.trim()
  };
};
const excerpt = (text, regex, fallback = 20) => {
  const lines = String(text || '').split(/\r?\n/);
  const picks = lines.filter((l) => regex.test(l));
  return picks.length ? picks.slice(-14) : lines.slice(-fallback);
};
const listBasenames = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
};
const prepareSample = (taskId) => {
  const month = taskId === '260330_045' ? '2026-03' : '2026-04';
  const monthDir = path.join(REPO_ROOT, 'rules', 'task-reports', month);
  const scoped = path.join(monthDir, taskId);
  const srcDir = fs.existsSync(scoped) ? scoped : monthDir;
  const outDir = path.join(REPO_ROOT, '.tmp', 'heavy_domain_static_260403_014', `sample_${taskId}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.includes(taskId)) continue;
    if (!/truth_audit/i.test(ent.name)) continue;
    fs.copyFileSync(path.join(srcDir, ent.name), path.join(outDir, ent.name));
  }
  return outDir;
};
const runFinalize = (taskId, profile, dir, domain = '') => {
  setLatest(taskId);
  const domainArg = domain ? ` --domain ${domain}` : '';
  return runCmd(`node scripts/finalize_task_evidence.mjs --task_id ${taskId} --result_dir "${dir}" --profile ${profile}${domainArg} --no_stage true --ci_clean_assumption false`);
};
const runGate = (taskId, profile, dir, domain = '') => {
  setLatest(taskId);
  const domainArg = domain ? ` --domain ${domain}` : '';
  return runCmd(`node scripts/gate_light_ci.mjs --task_id ${taskId} --result_dir "${dir}" --profile ${profile}${domainArg}`);
};

const main = async () => {
  const args = parseArgs();
  if (!ALLOWED_SAMPLES.includes(String(args.sampleName || '').trim())) throw new Error('ERR_INVALID_SAMPLE_NAME');
  const latestBackup = fs.readFileSync(latestPath, 'utf8');
  try {
    const lightDir = prepareSample('260330_045');
    const bizDir = prepareSample('260403_002');
    const govDir = prepareSample('260403_006');

    const bizFinalizeDefault = runFinalize('260403_002', 'heavy', bizDir);
    const bizGateDefault = runGate('260403_002', 'heavy', bizDir);
    const bizGateFull = runGate('260403_002', 'heavy', bizDir, 'full');
    const govFinalizeOpp = runFinalize('260403_006', 'heavy', govDir, 'opportunities');
    const govGateOpp = runGate('260403_006', 'heavy', govDir, 'opportunities');
    const lightFinalize = runFinalize('260330_045', 'light', lightDir);
    const lightGate = runGate('260330_045', 'light', lightDir);

    const defaultOut = `${bizFinalizeDefault.out}\n${bizGateDefault.out}`;
    const fullOut = bizGateFull.out;
    const oppOut = `${govFinalizeOpp.out}\n${govGateOpp.out}`;
    const lightOut = `${lightFinalize.out}\n${lightGate.out}`;

    const checks = {
      btcqdd_default_finalize_gate_pass: bizFinalizeDefault.ok && bizGateDefault.ok,
      btcqdd_default_runs_mandatory_snippet_healthcheck: /Heavy mandatory evidence verified/i.test(defaultOut)
        && /SnippetCommitMustMatch verified/i.test(defaultOut)
        && /Healthcheck evidence verified/i.test(defaultOut),
      btcqdd_default_skips_cross_domain_pack: /DOMAIN_SKIP: opportunities contract pack skipped \(domain=btcqdd\)/i.test(defaultOut)
        && !/HEAVY_PARALLEL_START: news\/rank\/export\/ledger/i.test(defaultOut)
        && !/HEAVY_PARALLEL_START: scanner\/universe\/trading/i.test(defaultOut),
      explicit_domain_full_runs_cross_domain_pack: bizGateFull.ok
        && /TASK_DOMAIN=full/i.test(fullOut)
        && /HEAVY_PARALLEL_START: news\/rank\/export\/ledger/i.test(fullOut)
        && /HEAVY_PARALLEL_START: scanner\/universe\/trading/i.test(fullOut),
      explicit_domain_opportunities_runs_cross_domain_pack: govFinalizeOpp.ok && govGateOpp.ok
        && /TASK_DOMAIN=opportunities/i.test(oppOut)
        && /HEAVY_PARALLEL_START: news\/rank\/export\/ledger/i.test(oppOut),
      light_smoke_unchanged: lightFinalize.ok && lightGate.ok
        && /LIGHT profile: skipping heavy-only contract checks/i.test(lightOut),
      skip_log_explainability: /DOMAIN_SKIP_CHECKS: news\/rank\/export\/ledger\/scanner\/universe\/trading/i.test(defaultOut)
    };
    const pass = Object.values(checks).every(Boolean);
    const fullFiles = listBasenames(bizDir);

    const output = {
      checks,
      default_btcqdd_files: fullFiles,
      key_lines: {
        btcqdd_default: excerpt(defaultOut, /(TASK_DOMAIN=|DOMAIN_SKIP|Heavy mandatory evidence verified|SnippetCommitMustMatch verified|Healthcheck evidence verified|GATE_LIGHT_EXIT=0|PASS)/i, 28),
        cross_domain_full: excerpt(fullOut, /(TASK_DOMAIN=full|HEAVY_PARALLEL_START|HEAVY_PARALLEL_DONE|GATE_LIGHT_EXIT=0|PASS)/i, 28),
        cross_domain_opportunities: excerpt(oppOut, /(TASK_DOMAIN=opportunities|HEAVY_PARALLEL_START|HEAVY_PARALLEL_DONE|GATE_LIGHT_EXIT=0|PASS)/i, 28),
        light_smoke: excerpt(lightOut, /(TASK_PROFILE=light|LIGHT profile: skipping heavy-only contract checks|GATE_LIGHT_EXIT=0|PASS)/i, 24)
      }
    };

    const standard = buildStandardResult({
      scriptName: 'truth_audit_heavy_domain_static_260403_014',
      taskId: args.taskId,
      sampleName: args.sampleName,
      pass,
      message: `first_break_layer=${pass ? 'NONE_CHAIN_PASS' : 'heavy_domain_static'}`,
      firstBreakLayer: pass ? 'NONE_CHAIN_PASS' : 'heavy_domain_static',
      evidenceFile: args.output,
      summary: { pass },
      rawExcerpt: output
    });
    const finalOutput = {
      ...standard,
      task_type: 'workflow_upgrade',
      conclusion_block: {
        verdict: pass ? 'A：通过' : 'C：存在断裂',
        first_break_layer: pass ? 'NONE_CHAIN_PASS' : 'heavy_domain_static'
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
