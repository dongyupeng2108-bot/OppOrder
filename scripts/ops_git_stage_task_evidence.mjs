import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Usage: node scripts/ops_git_stage_task_evidence.mjs --task_id=<task_id> --evidence_dir=<dir> --run_id=<run_id>

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

console.log(`[Staging] Task: ${taskId}, Dir: ${evidenceDir}, Run: ${runId}`);

// Helper to stage a file
function stageFile(file) {
    if (fs.existsSync(file)) {
        console.log(`Staging: ${file}`);
        try {
            // Use -f to force add ignored files
            execSync(`git add -f "${file}"`, { stdio: 'inherit' });
        } catch (e) {
            console.error(`Failed to stage ${file}: ${e.message}`);
        }
    } else {
        console.log(`Skipping missing: ${file}`);
    }
}

// 1. Stage explicit files from lists b, c, d, e
const filesToStage = [
    // Manifest in evidence dir
    path.join(evidenceDir, `evidence_manifest_${taskId}.json`),
    // Deliverables index in evidence dir (if present there, though it usually lives in index/)
    path.join(evidenceDir, `deliverables_index_${taskId}.json`),
    
    // Envelope
    path.join('rules/task-reports/envelopes', `${taskId}.envelope.json`),
    // Lock file
    path.join('rules/task-reports/locks', `${taskId}.lock.json`),
    // Index (Important!)
    path.join('rules/task-reports/index', `deliverables_index_${taskId}.json`),
    // LATEST.json
    'rules/LATEST.json',
    // Index updates
    'rules/task-reports/index/error_stats.jsonl',
    'rules/task-reports/index/runs_index.jsonl',
    // Generated evidence script itself
    path.join(evidenceDir, `generate_evidence_${taskId}.mjs`),
    // Scripts
    'scripts/ops_scan_text.mjs',
    'rules/rules/WORKFLOW.md',
    'scripts/assemble_evidence.mjs',
    'scripts/postflight_validate_envelope.mjs',
    '.github/workflows/gate-light.yml'
];

filesToStage.forEach(stageFile);

// 2. Stage runs directory (recursive) - list a)
if (runId) {
    const runsDir = path.join('rules/task-reports/runs', taskId, runId);
    if (fs.existsSync(runsDir)) {
        console.log(`Staging runs directory: ${runsDir}`);
        
        // Recursive function to get all files
        function getFiles(dir) {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                file = path.join(dir, file);
                const stat = fs.statSync(file);
                if (stat && stat.isDirectory()) {
                    results = results.concat(getFiles(file));
                } else {
                    results.push(file);
                }
            });
            return results;
        }

        const runFiles = getFiles(runsDir);
        runFiles.forEach(stageFile);
    } else {
        console.warn(`Runs directory not found: ${runsDir}`);
    }
}

console.log('Staging complete.');
