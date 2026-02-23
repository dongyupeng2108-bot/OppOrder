import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Usage: node scripts/ops_git_stage_task_evidence.mjs --task_id <task_id> --evidence_dir <dir> --run_id <run_id>

const args = process.argv.slice(2);
const taskIdArg = args.find(a => a.startsWith('--task_id='));
const evidenceDirArg = args.find(a => a.startsWith('--evidence_dir='));
const runIdArg = args.find(a => a.startsWith('--run_id='));

if (!taskIdArg || !evidenceDirArg) {
    console.error('Usage: node scripts/ops_git_stage_task_evidence.mjs --task_id=<id> --evidence_dir=<dir> [--run_id=<id>]');
    process.exit(1);
}

const taskId = taskIdArg.split('=')[1];
const evidenceDir = evidenceDirArg.split('=')[1];
const runId = runIdArg ? runIdArg.split('=')[1] : null;

console.log(`[Staging] Task: ${taskId}, Dir: ${evidenceDir}`);

const filesToStage = [
    // Manifest
    path.join(evidenceDir, `evidence_manifest_${taskId}.json`),
    // Envelope
    path.join('rules/task-reports/envelopes', `${taskId}.envelope.json`),
    // Report (if not envelope?) - Usually included in manifest
    // Lock file
    path.join('rules/task-reports/locks', `${taskId}.lock.json`),
    // Index (Important!)
    path.join('rules/task-reports/index', `deliverables_index_${taskId}.json`),
    // Any other relevant files in evidence dir that are NOT ignored (e.g. permanent logs if any)
    // But usually runtime reports are ignored. The instruction says "evidence manifest" and "envelope".
    // And "rules/task-reports/envelopes/*.json"
];

// Add generated evidence script itself if it's new
filesToStage.push(path.join(evidenceDir, `generate_evidence_${taskId}.mjs`));

// Add any other files created/modified
filesToStage.push('scripts/ops_scan_text.mjs');
filesToStage.push('rules/rules/WORKFLOW.md');
// Also add the scripts modified for debug/fix
filesToStage.push('scripts/assemble_evidence.mjs');
filesToStage.push('scripts/postflight_validate_envelope.mjs');
filesToStage.push('.github/workflows/gate-light.yml');

// Helper to stage
function stage(file) {
    if (fs.existsSync(file)) {
        console.log(`Staging: ${file}`);
        try {
            execSync(`git add "${file}"`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to stage ${file}: ${e.message}`);
        }
    } else {
        console.log(`Skipping missing: ${file}`);
    }
}

filesToStage.forEach(stage);

// Also force add the healthcheck mock files if they need to be in the repo for CI to see them?
// No, CI generates them or they are artifacts. But wait, if CI runs generate_evidence, it generates them.
// If CI runs assemble_evidence, it looks for them.
// In the user's instruction: "Generate minimal evidence set".
// And "git commit -m ...".
// The user wants to commit the EVIDENCE artifacts so that CI can verify them?
// Usually evidence is generated in CI.
// But the user says "生成最小证据集...把证据暂存并提交".
// This implies committing the evidence files to the repo.
// This might be to bypass some generation step or to provide a "golden" set.
// Or maybe just the manifest/envelope/index/lock.
// I will verify what files are usually committed.
// `rules/task-reports/YYYY-MM/` is usually ignored except for `generate_evidence_*.js`.
// `rules/task-reports/envelopes/` IS tracked.
// `rules/task-reports/index/` IS tracked.
// `rules/task-reports/locks/` IS tracked.
// So I should stage those.

console.log('Staging complete.');
