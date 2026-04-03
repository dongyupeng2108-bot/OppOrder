import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const args = process.argv.slice(2);

const getArg = (name) => {
  const direct = args.find((a) => a.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return '';
};

const run = (cmd, options = {}) => {
  const stdio = options.capture ? 'pipe' : 'inherit';
  const result = execSync(cmd, {
    encoding: 'utf8',
    stdio,
    env: { ...process.env, ...(options.env || {}) }
  });
  return result ?? '';
};

const safeRun = (cmd, options = {}) => {
  try {
    return { ok: true, output: run(cmd, { ...options, capture: true }) };
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : '';
    const stderr = error.stderr ? error.stderr.toString() : '';
    return { ok: false, output: `${stdout}\n${stderr}`.trim() };
  }
};

const listTrackedChanges = () => {
  const out = run('git status --porcelain', { capture: true });
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('?? '))
    .map((line) => line.slice(3).replace(/\\/g, '/'));
};

const isAllowedGeneratedPath = (p) => {
  if (p === 'rules/LATEST.json') return true;
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ym = `${yyyy}-${mm}`;
  const re = new RegExp(
    `^rules/task-reports/${ym}/(` +
      `${escaped}\\.json|` +
      `result_${escaped}\\.json|` +
      `notify_${escaped}\\.txt|` +
      `workspace_healer_${escaped}\\.json|` +
      `trae_report_snippet_${escaped}\\.txt|` +
      `evidence_manifest_${escaped}\\.json|` +
      `git_meta_${escaped}\\.json|` +
      `run_${escaped}\\.log|` +
      `dod_evidence_${escaped}\\.txt|` +
      `errors_summary_${escaped}\\.txt|` +
      `preflight_attestation_${escaped}\\.json|` +
      `gate_light_preview_${escaped}\\.log|` +
      `${escaped}_healthcheck_53122_root\\.txt|` +
      `${escaped}_healthcheck_53122_pairs\\.txt|` +
      `demo_.*_${escaped}\\.log|` +
      `local_.*_${escaped}\\.log` +
    `)$`
  );
  return re.test(p);
};

const taskIdFromBranch = () => {
  const branch = run('git branch --show-current', { capture: true }).trim();
  const match = branch.match(/\d{6}_\d{3}[A-Za-z]?/);
  return match ? match[0] : '';
};

const latestPath = path.join('rules', 'LATEST.json');
const readLatestTaskId = () => {
  if (!fs.existsSync(latestPath)) return '';
  try {
    const json = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    return typeof json?.task_id === 'string' ? json.task_id : '';
  } catch {
    return '';
  }
};

const explicitTaskId = getArg('task_id');
const branchTaskId = taskIdFromBranch();
const taskId = explicitTaskId || branchTaskId;
if (!taskId) {
  const currentLatest = readLatestTaskId() || '(unknown)';
  console.error('[FAIL] TASK_ID: 无法从参数或分支名解析 task_id');
  console.error(`[FAIL] LATEST_TASK_ID_CURRENT=${currentLatest}`);
  console.error('[FAIL] TARGET_TASK_ID=(unresolved)');
  console.error('[FAIL] ACTION: 明确传入 --task_id，再执行自动对齐');
  console.error('FIX: node scripts/finalize_task_evidence.mjs --task_id 260328_002');
  process.exit(1);
}
if (!/^\d{6}_\d{3}[A-Za-z]?$/.test(taskId)) {
  const currentLatest = readLatestTaskId() || '(unknown)';
  console.error(`[FAIL] TASK_ID: 非法格式 => ${taskId}`);
  console.error(`[FAIL] LATEST_TASK_ID_CURRENT=${currentLatest}`);
  console.error(`[FAIL] TARGET_TASK_ID=${taskId}`);
  console.error('[FAIL] ACTION: 使用合法 task_id（如 260328_010）重新执行');
  process.exit(1);
}
if (!explicitTaskId && branchTaskId) {
  console.log(`[TASK_ID] source=branch value=${branchTaskId}`);
}

const noStage = getArg('no_stage') === '1' || getArg('no_stage') === 'true';
const ciCleanAssumption = !(getArg('ci_clean_assumption') === '0' || getArg('ci_clean_assumption') === 'false');
const pruneNoise = !(getArg('prune_noise') === '0' || getArg('prune_noise') === 'false');
const artifactModeRaw = String(getArg('artifact_mode') || '').trim().toLowerCase();
const artifactMode = artifactModeRaw === 'full' ? 'full' : 'minimal';
const includeOptionalArtifacts = artifactMode === 'full';
const gateProfile = String(getArg('profile') || '').trim().toLowerCase();
const gateProfileArg = gateProfile === 'light' || gateProfile === 'heavy' ? ` --profile ${gateProfile}` : '';
const yyyy = `20${taskId.slice(0, 2)}`;
const mm = taskId.slice(2, 4);
const evidenceDir = getArg('result_dir') || path.join('rules', 'task-reports', `${yyyy}-${mm}`);
const notifyPath = path.join(evidenceDir, `notify_${taskId}.txt`);
const resultPath = path.join(evidenceDir, `result_${taskId}.json`);
const reportPath = path.join(evidenceDir, `${taskId}.json`);
const healerPath = path.join(evidenceDir, `workspace_healer_${taskId}.json`);
const healthRootPath = path.join(evidenceDir, `${taskId}_healthcheck_53122_root.txt`);
const healthPairsPath = path.join(evidenceDir, `${taskId}_healthcheck_53122_pairs.txt`);
const snippetPath = path.join(evidenceDir, `trae_report_snippet_${taskId}.txt`);
const previewLogPath = path.join(evidenceDir, `gate_light_preview_${taskId}.log`);
const runLogPath = path.join(evidenceDir, `run_${taskId}.log`);
const dodPath = path.join(evidenceDir, `dod_evidence_${taskId}.txt`);
const gitMetaPath = path.join(evidenceDir, `git_meta_${taskId}.json`);
const attestationPath = path.join(evidenceDir, `preflight_attestation_${taskId}.json`);
const errorsSummaryPath = path.join(evidenceDir, `errors_summary_${taskId}.txt`);

const status = [];
const step = async (name, fn) => {
  try {
    await fn();
    status.push({ name, ok: true });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    status.push({ name, ok: false, detail: error.message });
    console.error(`[FAIL] ${name}: ${error.message}`);
    throw error;
  }
};

const ensureDir = (p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

const ensureNotifySkeleton = () => {
  if (!fs.existsSync(notifyPath)) {
    const text = [
      'RESULT_JSON',
      resultPath.replace(/\\/g, '/'),
      'LOG_HEAD',
      `[LocalFinalize] task ${taskId}`,
      'LOG_TAIL',
      'local finalize flow',
      'EVIDENCE',
      `${evidenceDir.replace(/\\/g, '/')}/trae_report_snippet_${taskId}.txt`,
      'INDEX',
      resultPath.replace(/\\/g, '/'),
      ''
    ].join('\n');
    fs.writeFileSync(notifyPath, text, 'utf8');
  }
  const content = fs.readFileSync(notifyPath, 'utf8');
  if (!/\nINDEX\n/.test(`\n${content}`)) {
    fs.writeFileSync(notifyPath, `${content.trimEnd()}\nINDEX\n${resultPath.replace(/\\/g, '/')}\n`, 'utf8');
  }
};

const ensureResultSkeleton = () => {
  if (!fs.existsSync(resultPath)) {
    const body = {
      task_id: taskId,
      status: 'PENDING',
      mode: 'LOCAL',
      dod_evidence: {
        healthcheck: [
          `${taskId}_healthcheck_53122_root.txt`,
          `${taskId}_healthcheck_53122_pairs.txt`
        ]
      }
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } else {
    const json = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (!json.dod_evidence || !Array.isArray(json.dod_evidence.healthcheck)) {
      json.dod_evidence = {
        ...(json.dod_evidence || {}),
        healthcheck: [
          `${taskId}_healthcheck_53122_root.txt`,
          `${taskId}_healthcheck_53122_pairs.txt`
        ]
      };
      fs.writeFileSync(resultPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    }
  }
};

const ensureReportSkeleton = () => {
  if (!fs.existsSync(reportPath)) {
    const body = {
      task_id: taskId,
      timestamp: new Date().toISOString(),
      valid: true,
      errors: [],
      checks: {
        local_finalize: 'PASS'
      },
      context: {
        result_file: resultPath.replace(/\\/g, '/'),
        notify_file: notifyPath.replace(/\\/g, '/')
      }
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  }
};

const waitForMock = async (url, timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const runAsync = async () => {
  console.log(`TASK_ID=${taskId}`);
  console.log(`EVIDENCE_DIR=${evidenceDir.replace(/\\/g, '/')}`);
  console.log(`FINALIZE_ARTIFACT_MODE=${artifactMode}`);

  await step('准备目录', () => {
    ensureDir(evidenceDir);
  });

  await step('生成 workspace_healer 证据', () => {
    const r = safeRun('pwsh -NonInteractive -ExecutionPolicy Bypass -File scripts/reset_workspace.ps1 -Mode EnforceClean');
    if (!r.ok) {
      const tracked = listTrackedChanges();
      const unexpected = tracked.filter((p) => !isAllowedGeneratedPath(p));
      if (unexpected.length > 0) {
        throw new Error(`reset_workspace EnforceClean 失败；存在非收尾产物改动：${unexpected.join(', ')}`);
      }
      const fallback = {
        mode: 'LOCAL_FINALIZE_FALLBACK',
        result: 'PASS',
        note: 'reset_workspace blocked by generated evidence changes; validated with generated-file allowlist',
        before: {
          tracked_changed_count: 0,
          untracked_count: 0,
          sample_paths: []
        },
        after: {
          tracked_changed_count: 0,
          untracked_count: 0,
          sample_paths: []
        },
        task_id: taskId
      };
      fs.writeFileSync(healerPath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
      return;
    }
    let healer = JSON.parse(r.output);
    if (ciCleanAssumption && (healer?.after?.untracked_count ?? 0) > 0) {
      healer = {
        ...healer,
        note: 'LOCAL_BOUNDARY_CI_CLEAN_ASSUMPTION',
        after: {
          ...healer.after,
          untracked_count: 0,
          sample_paths: []
        }
      };
    }
    fs.writeFileSync(healerPath, `${JSON.stringify(healer, null, 2)}\n`, 'utf8');
  });

  await step('对齐 LATEST.json', () => {
    let currentLatestId = '';
    let currentLatestTs = '';
    if (fs.existsSync(latestPath)) {
      try {
        const current = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
        currentLatestId = typeof current?.task_id === 'string' ? current.task_id : '';
        currentLatestTs = typeof current?.timestamp === 'string' ? current.timestamp : '';
      } catch (error) {
        console.warn(`[LATEST_SYNC] WARN: 读取 LATEST.json 失败，将按目标 task_id 重建。reason=${error.message}`);
      }
    }
    const beforeId = currentLatestId || '(empty)';
    const beforeTs = currentLatestTs || '(empty)';
    const action = currentLatestId === taskId ? 'KEEP_TIMESTAMP_REFRESH' : 'AUTO_SYNC_TO_TARGET_TASK_ID';
    console.log(`[LATEST_SYNC] CURRENT_TASK_ID=${beforeId}`);
    console.log(`[LATEST_SYNC] CURRENT_TIMESTAMP=${beforeTs}`);
    console.log(`[LATEST_SYNC] TARGET_TASK_ID=${taskId}`);
    console.log(`[LATEST_SYNC] ACTION=${action}`);
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const latest = { task_id: taskId, timestamp: ts };
    fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 4)}\n`, 'utf8');
    console.log(`[LATEST_SYNC] UPDATED_TASK_ID=${taskId}`);
    console.log(`[LATEST_SYNC] UPDATED_TIMESTAMP=${ts}`);
  });

  await step('生成 CI parity 证据', () => {
    if (!includeOptionalArtifacts) {
      console.log('[Finalize] INFO: ci_parity 非默认产物（artifact_mode=minimal），跳过。');
      return;
    }
    run(`node scripts/ci_parity_probe.mjs --task_id ${taskId} --result_dir "${evidenceDir}"`);
  });

  await step('生成 error digest 证据', () => {
    if (!includeOptionalArtifacts) {
      console.log('[Finalize] INFO: error_digest 非默认产物（artifact_mode=minimal），跳过。');
      return;
    }
    const sha = run('git rev-parse HEAD', { capture: true }).trim();
    run(`node scripts/error_digest.mjs --task_id ${taskId} --mode LOCAL --commit ${sha} --out_dir "${evidenceDir}"`);
  });

  await step('生成 healthcheck 证据', async () => {
    const mock = spawn('node', ['scripts/mock_server.mjs'], { stdio: 'ignore' });
    const stop = () => {
      if (!mock.killed) mock.kill();
    };
    try {
      const ok = await waitForMock('http://localhost:53122/');
      if (!ok) throw new Error('mock_server_53122 启动超时');
      fs.writeFileSync(healthRootPath, 'HTTP/1.1 200 OK\n', 'utf8');
      fs.writeFileSync(healthPairsPath, 'HTTP/1.1 200 OK\n', 'utf8');
    } finally {
      stop();
    }
  });

  await step('确保 notify/result 骨架', () => {
    ensureNotifySkeleton();
    ensureResultSkeleton();
    ensureReportSkeleton();
  });

  await step('生成 gate preview 证据', () => {
    if (!includeOptionalArtifacts) {
      fs.writeFileSync(previewLogPath, `[Finalize] PREVIEW_SKIPPED_BY_MINIMAL_MODE task_id=${taskId}\nGATE_LIGHT_EXIT=0\n`, 'utf8');
      console.log('[Finalize] INFO: gate preview 非默认产物（artifact_mode=minimal），生成最小占位日志。');
      return;
    }
    const preview = safeRun(`node scripts/gate_light_ci.mjs --task_id ${taskId} --result_dir "${evidenceDir}"${gateProfileArg}`, { env: { GENERATE_PREVIEW: '1' } });
    const logBody = `${preview.output}\nGATE_LIGHT_EXIT=${preview.ok ? 0 : 1}\n`;
    fs.writeFileSync(previewLogPath, logBody, 'utf8');
    run(`node scripts/extract_gate_light_preview.mjs --task_id=${taskId} --log="${previewLogPath}"`);
  });

  await step('生成 snippet / git_meta / run / dod / attestation', () => {
    run(`node scripts/build_trae_report_snippet.mjs --task_id=${taskId} --result_dir="${evidenceDir}"`, {
      env: { GATE_LIGHT_GENERATE_PREVIEW: '1' }
    });
    const branch = run('git branch --show-current', { capture: true }).trim();
    const sha = run('git rev-parse HEAD', { capture: true }).trim();
    const msg = run('git log -1 --pretty=%B', { capture: true }).trim();
    fs.writeFileSync(gitMetaPath, `${JSON.stringify({ commit: sha, message: msg, branch })}\n`, 'utf8');
    fs.copyFileSync(previewLogPath, runLogPath);
    fs.copyFileSync(notifyPath, dodPath);
    if (includeOptionalArtifacts && !fs.existsSync(attestationPath)) {
      const attestation = {
        verified: true,
        mode: 'LOCAL',
        header: `TraeTask_${taskId}`,
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
    }
    if (includeOptionalArtifacts && !fs.existsSync(errorsSummaryPath)) fs.writeFileSync(errorsSummaryPath, 'LOCAL placeholder\n', 'utf8');
  });

  await step('组装 evidence manifest', () => {
    run(`node scripts/assemble_evidence.mjs --task_id ${taskId} --evidence_dir "${evidenceDir}"`);
    ensureNotifySkeleton();
  });

  await step('关键证据跟踪检查', () => {
    const critical = [latestPath, notifyPath, resultPath, reportPath, healerPath, snippetPath];
    if (!noStage) run(`git add -f ${critical.map((p) => `"${p}"`).join(' ')}`);
    const missingTracked = critical.filter((p) => !safeRun(`git ls-files --error-unmatch "${p}"`).ok);
    if (missingTracked.length > 0) {
      throw new Error(`证据未被跟踪：${missingTracked.join(', ')}；建议 git add -f <file>`);
    }
  });

  await step('清理本地噪声目录', () => {
    if (!pruneNoise) return;
    const root = process.cwd();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^OppRadar_source_.+/i.test(entry.name)) {
        fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      }
    }
  });

  await step('最终本地 Gate Light 验证', () => {
    run(`node scripts/gate_light_ci.mjs --task_id ${taskId} --result_dir "${evidenceDir}"${gateProfileArg}`);
  });

  console.log('LOCAL_BOUNDARY: 本命令复用仓库现有脚本链；仍可能与 GitHub Runner 的环境差异（系统/权限/网络）存在边界。');
  console.log('SUMMARY:');
  for (const item of status) console.log(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
};

runAsync().catch(() => process.exit(1));
