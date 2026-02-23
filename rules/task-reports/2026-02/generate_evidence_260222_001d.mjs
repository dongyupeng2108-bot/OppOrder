import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const taskId = '260222_001d';
const evidenceDir = 'rules/task-reports/2026-02';
const repoRoot = process.cwd();

if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
}

console.log(`[Evidence Generator] Running generation for Task ${taskId}...`);

try {
    const smokeOutput = execSync('node scripts/smoke_workspace_healer_static.mjs', { encoding: 'utf8' });
    const dodFile = path.join(evidenceDir, `dod_evidence_${taskId}.txt`);
    const evidenceContent = [
        '=== DOD_EVIDENCE_STDOUT ===',
        smokeOutput.trim(),
        '===========================',
        ''
    ].join('\n');
    fs.writeFileSync(dodFile, evidenceContent);
    console.log(`[Evidence Generator] Wrote: ${dodFile}`);

    const ciParityScript = path.join(repoRoot, 'scripts', 'ci_parity_probe.mjs');
    if (fs.existsSync(ciParityScript)) {
        execSync(`node "${ciParityScript}" --task_id=${taskId} --result_dir="${evidenceDir}"`, { stdio: 'inherit' });
    } else {
        const base = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
        const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        const mergeBase = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
        const diff = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();
        const scopeFiles = diff ? diff.split('\n').filter(Boolean) : [];
        const ciJson = {
            task_id: taskId,
            base,
            head,
            merge_base: mergeBase,
            scope_files: scopeFiles,
            scope_count: scopeFiles.length,
            generated_at: new Date().toISOString()
        };
        fs.writeFileSync(path.join(evidenceDir, `ci_parity_${taskId}.json`), JSON.stringify(ciJson, null, 2));
    }

    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const gitMeta = {
        branch,
        commit,
        task_id: taskId,
        generated_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(evidenceDir, `git_meta_${taskId}.json`), JSON.stringify(gitMeta, null, 2));

    const resultJson = {
        task_id: taskId,
        status: 'PENDING',
        summary: 'Task Execution Started',
        dod_evidence: {
            manual_verification: true
        }
    };
    fs.writeFileSync(path.join(evidenceDir, `result_${taskId}.json`), JSON.stringify(resultJson, null, 2));

    console.log('[Evidence Generator] SUCCESS: All evidence artifacts generated.');
} catch (e) {
    console.error(`[Evidence Generator] FAILED: ${e.message}`);
    process.exit(1);
}
