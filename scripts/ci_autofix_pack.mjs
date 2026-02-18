import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.indexOf(name);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
};

const taskId = getArg('--task_id');
if (!taskId) {
    console.error('Usage: node ci_autofix_pack.mjs --task_id <TASK_ID>');
    process.exit(1);
}

console.log(`[AutoFix] Running deterministic fixes for Task ${taskId}...`);

let changesMade = false;

// Helper to find evidence directory
const findEvidenceDir = (dir) => {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file === 'runs' || file === 'locks') continue;
            const res = findEvidenceDir(fullPath);
            if (res) return res;
        } else if (file === `result_${taskId}.json`) {
            return dir;
        }
    }
    return null;
};

// Default to current month if not found
let evidenceDir = null;
try {
    evidenceDir = findEvidenceDir(path.join(repoRoot, 'rules', 'task-reports'));
} catch (e) {}

if (!evidenceDir) {
    const yearMonth = new Date().toISOString().substring(0, 7);
    evidenceDir = path.join(repoRoot, 'rules', 'task-reports', yearMonth);
    console.log(`[AutoFix] Warning: Evidence dir not found. Defaulting to ${evidenceDir}`);
} else {
    console.log(`[AutoFix] Evidence Dir: ${evidenceDir}`);
}

// 1. CI Parity Fix
console.log('[AutoFix] 1. CI Parity / Evidence Refresh...');
try {
    // a. Fetch latest main
    console.log('    Fetching origin main...');
    execSync('git fetch origin main --prune', { stdio: 'inherit' });
    
    // b. Re-run CI Parity Probe
    console.log('    Running CI Parity Probe...');
    execSync(`node scripts/ci_parity_probe.mjs --task_id ${taskId} --result_dir "${evidenceDir}"`, { stdio: 'inherit', cwd: repoRoot });
    
    // c. Re-run Assemble Evidence
    console.log('    Re-assembling Evidence...');
    execSync(`node scripts/assemble_evidence.mjs --task_id ${taskId} --evidence_dir "${evidenceDir}" --mode Integrate --phase assemble`, { stdio: 'inherit', cwd: repoRoot });
    
    changesMade = true;
} catch (e) {
    console.error(`[AutoFix] CI Parity Fix failed: ${e.message}`);
}

// 2. LATEST.json Sync
console.log('[AutoFix] 2. LATEST.json Sync...');
try {
    const latestFile = path.join(repoRoot, 'rules', 'LATEST.json');
    let latest = {};
    if (fs.existsSync(latestFile)) {
        latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
    }
    
    if (latest.task_id !== taskId) {
        console.log(`[AutoFix] LATEST.json mismatch (${latest.task_id} != ${taskId}). Fixing...`);
        latest.task_id = taskId;
        
        const now = new Date();
        const timeStr = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0') + ' ' + 
            String(now.getHours()).padStart(2, '0') + ':' + 
            String(now.getMinutes()).padStart(2, '0') + ':' + 
            String(now.getSeconds()).padStart(2, '0');
            
        latest.timestamp = timeStr;
        
        fs.writeFileSync(latestFile, JSON.stringify(latest, null, 2));
        changesMade = true;
    } else {
        console.log('[AutoFix] LATEST.json is already correct.');
    }
} catch (e) {
    console.error(`[AutoFix] LATEST.json Fix failed: ${e.message}`);
}

// 3. Commit
if (changesMade) {
    console.log('[AutoFix] Committing changes...');
    try {
        // Add evidence dir files
        execSync(`git add "${evidenceDir}"`, { stdio: 'inherit' });
        // Add LATEST.json
        execSync(`git add rules/LATEST.json`, { stdio: 'inherit', cwd: repoRoot });
        
        // Check status
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (status.trim()) {
            execSync(`git commit -m "fix(auto): recompute ci parity and evidence (Task ${taskId})"`, { stdio: 'inherit' });
            console.log('[AutoFix] Changes committed.');
            
            console.log('[AutoFix] Pushing...');
            execSync('git push origin HEAD', { stdio: 'inherit' });
            console.log('[AutoFix] Push success.');
        } else {
            console.log('[AutoFix] No git changes detected after fixes.');
        }
    } catch (e) {
        console.error(`[AutoFix] Commit/Push failed: ${e.message}`);
        process.exit(1);
    }
} else {
    console.log('[AutoFix] No fixes needed or applied.');
}

process.exit(0);
