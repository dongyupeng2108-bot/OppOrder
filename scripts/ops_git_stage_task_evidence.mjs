import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Usage: node ops_git_stage_task_evidence.mjs --task_id <id> --evidence_dir <dir> [--run_id <id>]


const args = process.argv.slice(2);
const taskId = getArgValue(args, '--task_id');
const evidenceDir = getArgValue(args, '--evidence_dir');
const runId = getArgValue(args, '--run_id');

if (!taskId || !evidenceDir) {
    console.error("Usage: node ops_git_stage_task_evidence.mjs --task_id <id> --evidence_dir <dir> [--run_id <id>]");
    process.exit(1);
}

function getArgValue(args, key) {
    const index = args.indexOf(key);
    if (index !== -1 && index + 1 < args.length) {
        return args[index + 1];
    }
    // Fallback for '=' syntax
    const found = args.find(a => a.startsWith(key + '='));
    if (found) {
        return found.split('=')[1];
    }
    return null;
}

try {
    const filesToStage = [];

    // 1. Task Reports in evidenceDir (e.g. rules/task-reports/2026-02/taskId_*)
    if (fs.existsSync(evidenceDir)) {
        const files = fs.readdirSync(evidenceDir);
        files.forEach(file => {
            // Stage standard task files (taskId_*) AND workspace_healer (workspace_healer_taskId.json)
            if (file.startsWith(taskId) || file === `workspace_healer_${taskId}.json`) {
                filesToStage.push(path.join(evidenceDir, file));
            }
        });
    }

    // 2. Lock file
    const lockFile = path.join(repoRoot, `rules/task-reports/locks/${taskId}.lock.json`);
    if (fs.existsSync(lockFile)) {
        filesToStage.push(lockFile);
    }

    // 3. Index file (Always check if it exists)
    const indexFile = path.join(repoRoot, `rules/task-reports/index/deliverables_index.jsonl`);
    if (fs.existsSync(indexFile)) {
         filesToStage.push(indexFile);
    }
    
    // 4. Run logs (if runId provided)
    if (runId) {
        const runDir = path.join(repoRoot, `rules/task-reports/runs/${taskId}/${runId}`);
        // Try direct runId path first (legacy/flat)
        let runDirToStage = path.join(repoRoot, `rules/task-reports/runs/${runId}`);
        
        if (fs.existsSync(runDir)) {
             runDirToStage = runDir;
        }
        
        if (fs.existsSync(runDirToStage)) {
             filesToStage.push(runDirToStage);
        } else {
             console.warn(`[ops_git_stage] Run directory not found: ${runDir} or ${runDirToStage}`);
        }
    }

    // 5. Extra files specifically for 260223_007 and future standards
    const extraFiles = [
        path.join(repoRoot, 'rules/LATEST.json'),
        path.join(repoRoot, 'rules/task-reports/index/error_stats.jsonl'),
        path.join(repoRoot, 'rules/task-reports/index/runs_index.jsonl'),
        path.join(repoRoot, 'scripts/ops_scan_text.mjs'),
        path.join(repoRoot, 'rules/rules/WORKFLOW.md'),
        path.join(repoRoot, 'scripts/assemble_evidence.mjs'),
        path.join(repoRoot, 'scripts/postflight_validate_envelope.mjs'),
        path.join(repoRoot, '.github/workflows/gate-light.yml'),
        path.join(repoRoot, 'scripts/run_task.ps1'),
        path.join(repoRoot, 'scripts/ops_git_stage_task_evidence.mjs')
    ];
    
    extraFiles.forEach(f => {
        if (fs.existsSync(f)) filesToStage.push(f);
    });

    if (filesToStage.length === 0) {
        console.log("[ops_git_stage] No evidence files found to stage.");
        process.exit(0);
    }

    console.log(`[ops_git_stage] Staging ${filesToStage.length} paths for Task ${taskId}...`);
    
    // Use git add -f for each to ensure ignored files are added
    for (const file of filesToStage) {
        try {
            // Force add ignored files
            execSync(`git add -f "${file}"`, { stdio: 'inherit' });
        } catch (e) {
            console.warn(`[ops_git_stage] Warning: Failed to stage ${file}`);
            // Continue with others
        }
    }
    
    console.log("[ops_git_stage] Done.");

} catch (err) {
    console.error(`[ops_git_stage] Error: ${err.message}`);
    process.exit(1);
}
