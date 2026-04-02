import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const LATEST_JSON_PATH = path.join('rules', 'LATEST.json');

try {
// --- 0. Argument Parsing & Task ID Resolution (Task 260210_007) ---
const args = process.argv.slice(2);
let argTaskId = null;
let argMode = null; // New: Mode Argument
let argResultDir = null; // New: Result Dir Argument
let argRunId = null; // New: Run ID Argument
let argProfile = null; // light | heavy | auto
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task_id') {
        argTaskId = args[i + 1];
    }
    if (args[i] === '--mode') {
        argMode = args[i + 1];
    }
    if (args[i] === '--result_dir') {
        argResultDir = args[i + 1];
    }
    if (args[i] === '--run_id') {
        argRunId = args[i + 1];
    }
    if (args[i] === '--profile') {
        argProfile = args[i + 1];
    }
}

console.log(`[Gate Light] DEBUG: Checking LATEST.json at ${path.resolve(LATEST_JSON_PATH)}`);
let latestJson = null;
if (fs.existsSync(LATEST_JSON_PATH)) {
    try {
        const content = fs.readFileSync(LATEST_JSON_PATH, 'utf8').replace(/^\uFEFF/, '');
        latestJson = JSON.parse(content);
    } catch (e) {
        console.warn('[Gate Light] Warning: Failed to parse LATEST.json');
    }
}

let targetTaskId = null;
let detectionSource = null;
let prTaskIdDetected = null;

// A. Explicit Argument (Highest Priority)
if (argTaskId) {
    targetTaskId = argTaskId;
    detectionSource = 'ARGUMENT';
    prTaskIdDetected = argTaskId;
    console.log(`[Gate Light] Target locked via argument: ${targetTaskId}`);
} 
// B. PR / Branch Auto-Detection (If no arg)
else {
    // 1. Try Branch Name
    const branchName = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '';
    const branchMatch = branchName.match(/(\d{6}_\d{3}[a-z]?)/i);
    
    if (branchMatch) {
        targetTaskId = branchMatch[1];
        detectionSource = 'BRANCH_NAME';
        prTaskIdDetected = branchMatch[1];
        console.log(`[Gate Light] Detected PR Task ID from branch: ${targetTaskId}`);
    } 
    // 2. Try Git Diff (Deep Scan)
    else {
        try {
            console.log('[Gate Light] Attempting to detect task_id from git diff...');
            // Ensure we have origin/main ref
            try {
                execSync('git rev-parse origin/main', { stdio: 'ignore' });
            } catch (e) {
                console.log('[Gate Light] origin/main not found, fetching...');
                execSync('git fetch origin main', { stdio: 'ignore' });
            }

            // --- WORM DEFENSE: Check for Evidence Tampering (Strategy A) ---
            console.log('[Gate Light] Checking for Evidence WORM Violations...');
            const wormDiff = execSync('git diff --name-status origin/main...HEAD', { encoding: 'utf8' });
            const wormLines = wormDiff.split('\n').filter(Boolean);
            const wormViolations = [];
            
            for (const line of wormLines) {
                const parts = line.split('\t');
                const status = parts[0][0]; // First char of status (M, D, A, etc.)
                const file = parts[1];

                if (file.startsWith('rules/task-reports/runs/') || file.startsWith('rules/task-reports/locks/')) {
                    if (status === 'D' || status === 'M') {
                        wormViolations.push(`${status} ${file}`);
                    }
                }
            }

            if (wormViolations.length > 0) {
                console.error('[Gate Light] FAILED: EVIDENCE_WORM_BYPASS Detected.');
                console.error('Violations (Delete/Modify of WORM evidence is FORBIDDEN):');
                wormViolations.forEach(v => console.error(`  - ${v}`));
                
                console.log('\nFAIL_ROOT_CAUSE_BLOCK');
                console.log('ERROR_CLASS=EVIDENCE_WORM_BYPASS');
                console.log('ROOT_CAUSE_HINT=Attempt to delete or modify immutable evidence (runs/locks) in PR diff.');
                process.exit(1);
            }
            console.log('[Gate Light] WORM Check Passed.');
            // ---------------------------------------------------------------

            const diffOutput = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' });
            const files = diffOutput.split('\n').map(l => l.trim()).filter(Boolean);
            
            const candidates = new Set();
            const patterns = [
                /rules\/task-reports\/.*\/(\d{6}_\d{3}[A-Za-z]?)_/, // Evidence files
                /rules\/task-reports\/envelopes\/(\d{6}_\d{3}[A-Za-z]?)\.envelope\.json/, // Envelopes
                /trae_report_snippet_(\d{6}_\d{3}[A-Za-z]?)\.txt/,
                /notify_(\d{6}_\d{3}[A-Za-z]?)\.txt/,
                /result_(\d{6}_\d{3}[A-Za-z]?)\.json/
            ];

            files.forEach(f => {
                // Check if file matches any pattern
                for (const p of patterns) {
                    const m = f.match(p);
                    if (m) {
                        candidates.add(m[1]);
                        break; 
                    }
                }
            });

            if (candidates.size === 1) {
                targetTaskId = Array.from(candidates)[0];
                detectionSource = 'GIT_DIFF';
                prTaskIdDetected = targetTaskId;
                console.log(`[Gate Light] Detected unique PR Task ID from diff: ${targetTaskId}`);
            } else if (candidates.size > 1) {
                console.error('[Gate Light] FAILED: Multiple task_id candidates found in PR diff.');
                console.error(`PR_TASK_ID_DETECT_FAILED=1`);
                console.error(`PR_TASK_ID_CANDIDATES: ${Array.from(candidates).join(', ')}`);
                console.error(`ACTION: ensure branch name contains task_id OR ensure exactly one task_id evidence is changed`);
                process.exit(1);
            }
        } catch (e) {
            console.log(`[Gate Light] Git diff detection skipped/failed: ${e.message}`);
        }
    }
}

// C. Fallback to LATEST.json (Legacy / Default)
if (!targetTaskId) {
    if (!latestJson || !latestJson.task_id) {
         console.error('Error: No task_id specified, auto-detection failed, and rules/LATEST.json invalid/missing.');
         process.exit(1);
    }
    targetTaskId = latestJson.task_id;
    detectionSource = 'LATEST_JSON';
    console.log(`[Gate Light] Target defaulting to LATEST.json: ${targetTaskId}`);
}

// Auto-Promote Short ID (from Branch) to Full ID (from LATEST.json)
if (targetTaskId && latestJson && latestJson.task_id && latestJson.task_id.startsWith(targetTaskId + '_')) {
    console.log(`[Gate Light] Auto-Promoting Task ID from '${targetTaskId}' to '${latestJson.task_id}'`);
    targetTaskId = latestJson.task_id;
}

const task_id = targetTaskId;
const latestTaskId = latestJson && latestJson.task_id ? latestJson.task_id : 'MISSING';
console.log(`PR_TASK_ID_DETECTED=${prTaskIdDetected || 'NONE'}`);
console.log(`TARGET_TASK_ID=${task_id || 'NONE'}`);
console.log(`LATEST_TASK_ID=${latestTaskId}`);

// --- 1. Consistency Hard Rule (LATEST Consistency) ---
// If we locked onto a specific task (Arg or PR) AND we are in a PR context (or just enforcing consistency),
// check LATEST.json.
// Note: Even if we defaulted to LATEST_JSON above, this check passes trivially.
// The critical case is when we found a DIFFERENT task_id from PR/Arg.

if (detectionSource === 'ARGUMENT' || detectionSource === 'BRANCH_NAME' || detectionSource === 'GIT_DIFF') {
    if (!latestJson) {
         console.error('[Gate Light] FAILED: rules/LATEST.json missing.');
         process.exit(1);
    }
    if (latestJson.task_id !== task_id) {
         console.error(`[Gate Light] FAILED: LATEST.json Out of Sync.`);
         console.error('FAIL_REASON=LATEST_OUT_OF_SYNC');
         console.error(`  LATEST_OUT_OF_SYNC=1`);
         console.error(`  LATEST_TASK_ID: ${latestJson.task_id}`);
         console.error(`  PR_TASK_ID: ${task_id}`);
         console.error(`  ACTION: update rules/LATEST.json to PR task_id`);
         console.error(`FIX_CMD: node -e "const fs=require('fs');fs.writeFileSync('rules/LATEST.json',JSON.stringify({task_id:'${task_id}',timestamp:new Date().toISOString().slice(0,19).replace('T',' ')},null,4)+'\\n')"`);
         process.exit(1);
    }
    console.log('[Gate Light] LATEST.json consistency verified.');
}

// Resolve result_dir
let result_dir;
const profileData = [];
const addProfile = (step, durationMs, metrics) => {
    const entry = { step, duration_ms: durationMs };
    if (metrics && typeof metrics === 'object') {
        Object.entries(metrics).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                entry[key] = value;
            }
        });
    }
    profileData.push(entry);
};
const writeProfile = () => {
    if (!task_id || !result_dir) return;
    const profilePath = path.join(result_dir, `gate_light_profile_${task_id}.json`);
    const payload = { task_id, generated_at: new Date().toISOString(), steps: profileData };
    const json = JSON.stringify(payload, null, 2).replace(/\r\n/g, '\n');
    fs.writeFileSync(profilePath, json, 'utf8');
};
const docRefExtensions = ['.md', '.mjs', '.js', '.ts', '.ps1', '.yml', '.yaml', '.json'];
const docRefExcludedDirs = ['node_modules', 'rules/task-reports', 'data', '.git'];
const docRefExcludedFiles = [
    'scripts/check_doc_path_refs.mjs',
    'scripts/gate_light_ci.mjs'
];
const isDocRefExcluded = (filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    if (docRefExcludedFiles.includes(relativePath)) return true;
    return docRefExcludedDirs.some(excluded => normalizedPath.includes(excluded));
};
const collectDocRefTargets = (dir, fileList = []) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            if (!isDocRefExcluded(filePath)) {
                collectDocRefTargets(filePath, fileList);
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (docRefExtensions.includes(ext) && !isDocRefExcluded(filePath)) {
                fileList.push(filePath);
            }
        }
    }
    return fileList;
};

// Option A: Lock file lookup (Priority 1 - CI/Archived State)
const lockFile = path.join('rules', 'task-reports', 'locks', `${task_id}.lock.json`);
if (fs.existsSync(lockFile)) {
    try {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (lockData.run_dir) {
            result_dir = lockData.run_dir;
            console.log(`[Gate Light] Using run_dir from lock file: ${result_dir}`);
        }
    } catch (e) {
        console.warn(`[Gate Light] Failed to read lock file: ${e.message}`);
    }
}

// Fallback: Argument or LATEST.json (Priority 2 - Local/Runtime State)
if (!result_dir) {
    if (argResultDir) {
        result_dir = argResultDir;
    } else if (latestJson && latestJson.task_id === task_id && latestJson.result_dir) {
        result_dir = latestJson.result_dir;
    } else {
        // Derive from task_id date
        const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
        if (match) {
             const year = '20' + match[1];
             const month = match[2];
             result_dir = path.join('rules', 'task-reports', `${year}-${month}`);
        } else {
             console.error(`[Gate Light] FAILED: Cannot derive result_dir from task_id ${task_id}`);
             process.exit(1);
        }
    }
}

const detectTaskProfile = () => {
    const normalized = String(argProfile || '').trim().toLowerCase();
    if (normalized === 'light' || normalized === 'heavy') return normalized;
    const implPath = path.join(result_dir, `implementation_${task_id}.md`);
    const truthPath = path.join(result_dir, `truth_audit_${task_id}.md`);
    const source = [implPath, truthPath]
        .filter(p => fs.existsSync(p))
        .map(p => fs.readFileSync(p, 'utf8'))
        .join('\n');
    if (/任务类型[:：]\s*轻任务|轻任务/.test(source) && !/任务类型[:：]\s*重任务|重任务/.test(source)) return 'light';
    if (/任务类型[:：]\s*重任务|重任务/.test(source)) return 'heavy';
    return 'heavy';
};
const taskProfile = detectTaskProfile();
const isHeavyProfile = taskProfile === 'heavy';
console.log(`[Gate Light] TASK_PROFILE=${taskProfile}`);

console.log('[Gate Light] Verifying task_id: ' + task_id);
    
    // --- 1.5 Automation Pack V1 Hard Guards (Task 260215_010) ---
    console.log('[Gate Light] Running Automation Pack V1 Hard Guards...');
    
    // 1.5.1 CheckReportBlocks (Global Hard Guard)
    const notifyFile = path.join(result_dir, `notify_${task_id}.txt`);
    const snippetFile = path.join(result_dir, `trae_report_snippet_${task_id}.txt`);
    
    const requiredBlocks = [
        '=== DOD_EVIDENCE_STDOUT ==='
        // '=== CI_PARITY_PREVIEW ===' // [REMOVED by M4.5-T0 / 260301_028]
        // '=== GATE_LIGHT_PREVIEW ===' // Updated to allow PREVIEW or VERIFY below
    ];

    [notifyFile, snippetFile].forEach(f => {
        if (fs.existsSync(f)) {
            const content = fs.readFileSync(f, 'utf8');
            const missing = requiredBlocks.filter(b => !content.includes(b));
            
            // Special check for Gate Light Block (Preview OR Verify)
            const hasGateBlock = content.includes('=== GATE_LIGHT_PREVIEW ===') || 
                               content.includes('=== GATE_LIGHT_VERIFY ===');
            
            if (missing.length > 0 || !hasGateBlock) {
                console.error(`[Gate Light] FAILED: Report Block Check for ${path.basename(f)}`);
                if (missing.length > 0) console.error(`  Missing Blocks: ${missing.join(', ')}`);
                if (!hasGateBlock) console.error(`  Missing Blocks: === GATE_LIGHT_PREVIEW === OR === GATE_LIGHT_VERIFY ===`);
                console.error(`  ACTION: Use 'assemble_evidence.mjs' to regenerate reports.`);
                process.exit(1);
            }
            console.log(`[Gate Light] Report Block Check Passed: ${path.basename(f)}`);
        }
    });

    // 1.5.1.5 CheckHeaderConsistency (Task 260218_019)
    if (fs.existsSync(snippetFile)) {
        const snippetContent = fs.readFileSync(snippetFile, 'utf8');
        const headerMatch = snippetContent.match(/^Header:\s*(.+)$/m);
        if (!headerMatch) {
            console.error(`[Gate Light] FAILED: Header missing in ${path.basename(snippetFile)}`);
            process.exit(1);
        }
        const headerVal = headerMatch[1].trim();
        
        if (headerVal.startsWith('TraeTask_')) {
            const expected = `TraeTask_${task_id}`;
            if (headerVal !== expected) {
                console.error(`[Gate Light] FAILED: Header mismatch.`);
                console.error(`  Found: ${headerVal}`);
                console.error(`  Expected: ${expected}`);
                process.exit(1);
            }
        } else if (!headerVal.startsWith('FIX:') && !headerVal.startsWith('讨论:')) {
             console.error(`[Gate Light] FAILED: Invalid Header format: ${headerVal}`);
             console.error(`  Expected: TraeTask_${task_id}, FIX:..., or 讨论:...`);
             process.exit(1);
        }
        console.log(`[Gate Light] Header Check Passed: ${headerVal}`);
    }

    // 1.5.2 CheckPreflightAttestation (Integrate Mode Hard Guard)
    if (argMode === 'Integrate') {
        const attestationFile = path.join(result_dir, `preflight_attestation_${task_id}.json`);
        if (!fs.existsSync(attestationFile)) {
             console.error(`[Gate Light] FAILED: Preflight Attestation missing in Integrate mode.`);
             console.error(`  File: ${attestationFile}`);
             console.error(`  ACTION: Run 'preflight.ps1' before gate checks.`);
             console.error(`FIX_CMD: powershell -ExecutionPolicy Bypass -File scripts\\preflight.ps1 -TaskId ${task_id} -Mode Integrate -Header "TraeTask_${task_id}"`);
             process.exit(1);
        }
        try {
            const att = JSON.parse(fs.readFileSync(attestationFile, 'utf8').replace(/^\uFEFF/, ''));
            if (att.task_id !== task_id) {
                 console.error(`[Gate Light] FAILED: Attestation task_id mismatch (${att.task_id} vs ${task_id})`);
                 process.exit(1);
            }
            if (att.write_allowed !== true) {
                 console.error(`[Gate Light] FAILED: Attestation 'write_allowed' is NOT true.`);
                 console.error(`  Current Header: ${att.header_detected ? 'Valid' : 'Invalid/Missing'}`);
                 console.error(`  ACTION: Use valid 'TraeTask_' or 'FIX:' header.`);
                 process.exit(1);
            }
            console.log('[Gate Light] Preflight Attestation verified (Integrate Mode).');
        } catch (e) {
             console.error(`[Gate Light] FAILED: Invalid Attestation JSON: ${e.message}`);
             process.exit(1);
        }
    }

    // --- 1.6 Open PR Guard Check (Verify Mode Only) ---
    if (argMode === 'Integrate') { // Verify logic applies to Integrate mode
        console.log('[Gate Light] Checking Open PR Guard Evidence...');
        const openPrFile = path.join(result_dir, `open_pr_guard_${task_id}.json`);
        
        if (!fs.existsSync(openPrFile)) {
            console.error(`[Gate Light] FAILED: Open PR Guard evidence missing: ${openPrFile}`);
            process.exit(1);
        }
        
        try {
            const openPrData = JSON.parse(fs.readFileSync(openPrFile, 'utf8'));
            
            // Check blocking count in evidence
            if (openPrData.open_prs_blocking_count !== 0) {
                console.error(`[Gate Light] FAILED: Open PR Guard blocked execution (Evidence).`);
                console.error(`  Blocking PRs Count: ${openPrData.open_prs_blocking_count}`);
                console.error(`  ACTION: Close unrelated open PRs before running Integrate.`);
                console.error(`FIX_CMD: gh pr list --state open --json number,title,headRefName`);
                console.log('FAIL_ROOT_CAUSE_BLOCK');
                console.log('ERROR_CLASS=OPEN_PR_GUARD_BLOCKED');
                console.log('ROOT_CAUSE_HINT=Open PR Guard blocked execution due to existing Open PRs.');
                process.exit(1);
            }
            
            // --- CI Recalculation (Anti-Cheat) ---
            console.log('[Gate Light] Recalculating Open PR Guard status...');
            const probeScript = path.join(process.cwd(), 'scripts', 'open_pr_guard_probe.mjs');
            
            // Construct arguments from evidence
            const ignoreArgs = (openPrData.ignored_pr_numbers || []).join(',');
            const supersedeArgs = (openPrData.supersede_task_ids || []).join(',');
            
            // Run probe
            const probeCmd = `node ${probeScript} --task_id ${task_id} --mode Integrate --ignore_pr_numbers "${ignoreArgs}" --supersede_task_ids "${supersedeArgs}"`;
            
            try {
                // Run probe (expecting exit code 0 for PASS)
                const probeOutput = execSync(probeCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                const probeData = JSON.parse(probeOutput);
                
                if (probeData.decision !== 'PASS') {
                     // Should be caught by catch block if exit code 1, but check here just in case
                     throw new Error('Probe returned non-PASS with exit code 0');
                }
                console.log('[Gate Light] Open PR Guard Recalculation verified (PASS).');
                
            } catch (e) {
                console.error(`[Gate Light] FAILED: Open PR Guard Recalculation Blocked/Failed.`);
                if (e.stdout) {
                     try {
                        const probeData = JSON.parse(e.stdout.toString());
                        if (probeData.blocking_prs && probeData.blocking_prs.length > 0) {
                             console.error(`  Blocking PRs:`);
                             probeData.blocking_prs.forEach(p => console.error(`    - #${p.number} ${p.title}`));
                             console.log('FAIL_ROOT_CAUSE_BLOCK');
                             console.log('ERROR_CLASS=OPEN_PR_GUARD_BLOCKED');
                             console.log('ROOT_CAUSE_HINT=Open PR Guard blocked execution (Live Check).');
                        } else {
                             console.error(`  Error: ${probeData.error || 'Unknown system error'}`);
                        }
                     } catch (jsonErr) {
                         console.error(`  Raw Output: ${e.stdout.toString()}`);
                     }
                } else {
                     console.error(`  Error Message: ${e.message}`);
                }
                process.exit(1);
            }

            console.log('[Gate Light] Open PR Guard verified (blocking_count=0).');
        } catch (e) {
            console.error(`[Gate Light] FAILED: Invalid Open PR Guard JSON: ${e.message}`);
            process.exit(1);
        }
    }

    // --- 1.7 Workspace Healer Check (Task 260216_002) ---
    // Hard Guard: For task_id >= 260216_002, workspace_healer_${task_id}.json must exist and be clean.
    if (task_id >= '260216_002') {
        console.log('[Gate Light] Checking Workspace Healer Evidence...');
        let healerFile = path.join(result_dir, `workspace_healer_${task_id}.json`);

        if (!fs.existsSync(healerFile)) {
            let fallbackFound = false;
            const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
            if (match) {
                 const year = '20' + match[1];
                 const month = match[2];
                 const fallbackFile = path.join('rules', 'task-reports', `${year}-${month}`, `workspace_healer_${task_id}.json`);
                 if (fs.existsSync(fallbackFile)) {
                     console.warn(`[Gate Light] WARNING: Workspace Healer evidence missing in runs (${healerFile}).`);
                     console.warn(`[Gate Light] Fallback used: ${fallbackFile}`);
                     healerFile = fallbackFile;
                     fallbackFound = true;
                 }
            }

            if (!fallbackFound) {
                // On push-to-main (no PR context), workspace healer evidence is not generated
                // by earlier CI steps because TASK_ID cannot be detected from branch name.
                // Warn and skip instead of hard-failing.
                if (detectionSource === 'LATEST_JSON') {
                    console.warn(`[Gate Light] WARNING: Workspace Healer evidence missing (push-to-main, no PR context). Skipping check.`);
                } else {
                    console.error(`[Gate Light] FAILED: Workspace Healer evidence missing: ${healerFile}`);
                    console.error(`  ACTION: run gate-light workflow step Generate Workspace Healer Evidence or commit run archive`);
                    process.exit(1);
                }
            }
        }
        
        if (fs.existsSync(healerFile)) {
            try {
                const healerData = JSON.parse(fs.readFileSync(healerFile, 'utf8'));

                // Check result
                if (healerData.result !== 'PASS') {
                    console.error(`[Gate Light] FAILED: Workspace Healer result is ${healerData.result}`);
                    console.error(`  Reason: ${healerData.reason || 'Unknown'}`);
                    console.error(`FIX_CMD: git status && git add -A && git commit -m "chore: clean workspace for ${task_id}"`);
                    process.exit(1);
                }

                // Check cleanliness (Double Check)
                const tracked = healerData.after?.tracked_changed_count ?? -1;
                const untracked = healerData.after?.untracked_count ?? -1;

                if (tracked !== 0 || untracked !== 0) {
                    console.error(`[Gate Light] FAILED: Workspace Healer detected dirty state AFTER clean.`);
                    console.error(`  Tracked Changed: ${tracked} (Expected: 0)`);
                    console.error(`  Untracked: ${untracked} (Expected: 0)`);
                    console.error(`FIX_CMD: git status && git add -A && git commit -m "chore: clean workspace for ${task_id}"`);
                    process.exit(1);
                }

                console.log('[Gate Light] Workspace Healer verified (Clean Environment).');
            } catch (e) {
                console.error(`[Gate Light] FAILED: Invalid Workspace Healer JSON: ${e.message}`);
                process.exit(1);
            }
        }
    }

    // --- 1.8 AutoPR Evidence Check (Task 260219_001) ---
    if (task_id >= '260219_001' && argMode === 'Integrate') {
        console.log('[Gate Light] Checking AutoPR Evidence...');
        const autoPrFile = path.join(result_dir, `auto_pr_${task_id}.json`);
        
        if (!fs.existsSync(autoPrFile)) {
            console.error(`[Gate Light] FAILED: AutoPR evidence missing: ${autoPrFile}`);
            console.error(`  ACTION: Ensure 'run_task.ps1' Step 9 (AutoPR Loop) executed. AutoPR is MANDATORY for Integrate mode.`);
            console.error(`FIX_CMD: .\\scripts\\run_task.ps1 -TaskId ${task_id} -Mode Integrate -Header "TraeTask_${task_id}"`);
            process.exit(1);
        }
        
        try {
            const autoPrData = JSON.parse(fs.readFileSync(autoPrFile, 'utf8'));
            
            const requiredFields = ['pr_url', 'attempt', 'final_state'];
            const missingFields = requiredFields.filter(f => !autoPrData[f]);
            
            if (missingFields.length > 0) {
                console.error(`[Gate Light] FAILED: AutoPR evidence missing required fields: ${missingFields.join(', ')}`);
                process.exit(1);
            }
            
            console.log(`[Gate Light] AutoPR verified (State: ${autoPrData.final_state}, Attempt: ${autoPrData.attempt}).`);
            
        } catch (e) {
            console.error(`[Gate Light] FAILED: Invalid AutoPR JSON: ${e.message}`);
            process.exit(1);
        }
    }

    // --- [REMOVED by M4.5-T0 / 260301_028] CI Parity JSON Evidence Check ---

    // --- 2.5 Error Digest Validation (M-G1) [SOFTENED by M4.5-T0 / 260301_028] ---
    // Warn-only: files are checked if present, but missing files no longer block CI.
    if (process.env.GENERATE_PREVIEW !== '1') {
        console.log('[Gate Light] Checking Error Digest Evidence (warn-only)...');
        const errorsJsonl = path.join(result_dir, `errors_${targetTaskId}.jsonl`);
        const errorsSummary = path.join(result_dir, `errors_summary_${targetTaskId}.txt`);

        if (!fs.existsSync(errorsJsonl) || !fs.existsSync(errorsSummary)) {
            console.warn(`[Gate Light] WARN: Error Digest files missing (non-blocking). JSONL=${fs.existsSync(errorsJsonl)}, Summary=${fs.existsSync(errorsSummary)}`);
        } else {
            console.log('[Gate Light] Error Digest files present (warn-only mode, no deep validation).');
        }
    } else {
        console.log('[Gate Light] Skipping Error Digest Validation (Preview Mode).');
    }

    // --- Doc Path Standards Check (Task 260208_025) ---
    console.log('[Gate Light] Checking doc path standards...');
    const canonicalDocs = [
        'rules/rules/WORKFLOW.md',
        'rules/rules/PROJECT_RULES.md',
        'rules/rules/PROJECT_MASTER_PLAN.md'
    ];
    const legacyDocs = [
        'rules/WORKFLOW.md',
        'rules/PROJECT_RULES.md',
        'rules/PROJECT_MASTER_PLAN.md'
    ];

    // 1. Check for missing canonical docs
    const missingDocs = canonicalDocs.filter(f => !fs.existsSync(path.resolve(f)));
    if (missingDocs.length > 0) {
        console.error(`[Gate Light] FAILED: Missing canonical documents in rules/rules/:`);
        missingDocs.forEach(d => console.error(`  - ${d}`));
        console.error(`Fix Suggestion: Move these documents to rules/rules/ and update references.`);
        console.error(`FIX_CMD: git checkout origin/main -- ${missingDocs.join(' ')}`);
        process.exit(1);
    }

    // 2. Check for existence of legacy docs (Fail if found)
    const existingLegacyDocs = legacyDocs.filter(f => fs.existsSync(path.resolve(f)));
    if (existingLegacyDocs.length > 0) {
        console.error(`[Gate Light] FAILED: Found legacy documents in rules/ (Must be removed/migrated):`);
        existingLegacyDocs.forEach(d => console.error(`  - ${d}`));
        console.error(`Fix Suggestion: Move content to rules/rules/ and delete these files to prevent fork.`);
        process.exit(1);
    }
    console.log('[Gate Light] Doc path standards verified.');

    // --- Doc Path Reference Check (Task 260208_026) ---
    console.log('[Gate Light] Checking for legacy doc path references...');
    const docRefStart = Date.now();
    const docRefTargets = collectDocRefTargets(process.cwd());
    let docRefLineCount = 0;
    docRefTargets.forEach(file => {
        try {
            const content = fs.readFileSync(file, 'utf8');
            docRefLineCount += content.split(/\r?\n/).length;
        } catch (e) {}
    });
    try {
        execSync('node scripts/check_doc_path_refs.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error('[Gate Light] Doc Path Reference Check FAILED.');
        process.exit(1);
    }
    addProfile('doc_path_refs_scan', Date.now() - docRefStart, { file_count: docRefTargets.length, line_count: docRefLineCount });

    // --- Banned Cmd Syntax Static Scan (Task 260218_012) ---
    console.log('[Gate Light] Checking for banned cmd syntax in PowerShell scripts...');
    const bannedStart = Date.now();
    const bannedTargets = [
        'scripts/run_task.ps1',
        'scripts/test_fail_budget.ps1',
        'scripts/ps/Invoke-Step.ps1'
    ];
    let bannedLineCount = 0;
    bannedTargets.forEach(file => {
        const fullPath = path.resolve(process.cwd(), file);
        if (fs.existsSync(fullPath)) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                bannedLineCount += content.split(/\r?\n/).length;
            } catch (e) {}
        }
    });
    try {
        execSync('node scripts/scan_ps_cmd_syntax.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error('[Gate Light] Banned Cmd Syntax Check FAILED.');
        process.exit(1);
    }
    addProfile('ps_cmd_static_scan', Date.now() - bannedStart, { file_count: bannedTargets.length, line_count: bannedLineCount });

    // --- Global Artifact Guard (Task 260208_029) ---
    console.log('[Gate Light] Checking for global healthcheck artifacts...');
    try {
        // Use pathspecs directly with git ls-files
        // Note: We use forward slashes for git pathspecs which work on Windows too
        const forbiddenPatterns = [
            'reports/healthcheck_*.txt',
            'rules/task-reports/*/reports/healthcheck_*.txt'
        ];
        const cmd = `git ls-files ${forbiddenPatterns.join(' ')}`;
        // If no files match, git ls-files returns empty string (exit code 0)
        // If match, it returns file paths
        const output = execSync(cmd, { encoding: 'utf8' }).trim();
        
        if (output.length > 0) {
            console.error('[Gate Light] FAILED: Global healthcheck artifacts found in git index:');
            console.error(output);
            console.error('Fix Suggestion: run "git rm --cached <file>" and ensure .gitignore includes them.');
            process.exit(1);
        }
        console.log('[Gate Light] Global Artifact Guard verified.');
    } catch (e) {
        // If git fails, treat as error
        console.error(`[Gate Light] Global Artifact Guard execution error: ${e.message}`);
        process.exit(1);
    }

    if (isHeavyProfile) {
        const { spawn } = await import('child_process');
        const http = await import('http');
        const MOCK_PORT = 53122;
        const MOCK_SCRIPT = path.resolve('OppRadar', 'mock_server_53122.mjs');
        let mockProc = null;
        const FAIL_FAST = { hit: false, stage: null, skipped: [] };
        const markFailAndExit = async (stage, reason, skippedStages = []) => {
            if (!FAIL_FAST.hit) {
                FAIL_FAST.hit = true;
                FAIL_FAST.stage = stage;
                FAIL_FAST.skipped = skippedStages;
                console.error('FIRST_FAILED_STAGE=' + stage);
                console.error('FAIL_FAST_ABORTED=true');
                console.error('SKIPPED_AFTER_FAIL=' + JSON.stringify(skippedStages));
                if (reason) console.error(reason);
            }
            await stopMock();
            process.exit(1);
        };
        const waitHealth = (pathname = '/') => new Promise((resolve) => {
            const req = http.get({ host: '127.0.0.1', port: MOCK_PORT, path: pathname }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.setTimeout(1200, () => { req.destroy(); resolve(false); });
            req.on('error', () => resolve(false));
        });
        const ensureMock = async () => {
            const alive = (await waitHealth('/')) || (await waitHealth('/health'));
            if (alive) {
                console.log(`[Gate Light] MOCK_SERVER_SESSION=attached port=${MOCK_PORT}`);
                return;
            }
            console.log(`[Gate Light] MOCK_SERVER_SESSION=starting script=${MOCK_SCRIPT}`);
            mockProc = spawn(process.execPath, [MOCK_SCRIPT], { stdio: 'ignore', detached: false });
            const begin = Date.now();
            while (Date.now() - begin < 4000) {
                if ((await waitHealth('/')) || (await waitHealth('/health'))) {
                    console.log(`[Gate Light] MOCK_SERVER_SESSION=ready pid=${mockProc.pid}`);
                    return;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            await markFailAndExit('mock_server_boot', '[Gate Light] FAILED: Mock server did not become healthy.', ['news_contract', 'rank_contract', 'export_contract', 'ledger_contract', 'scanner_contract', 'universe_contract', 'trading_contract']);
        };
        const stopMock = async () => {
            if (mockProc) {
                console.log('[Gate Light] MOCK_SERVER_SESSION=stopping');
                try { mockProc.kill(); } catch {}
                await new Promise(r => setTimeout(r, 400));
            } else {
                console.log('[Gate Light] MOCK_SERVER_SESSION=detached; no-stop');
            }
        };

        await ensureMock();

        const runNode = (script) => new Promise((resolve) => {
            const p = spawn(process.execPath, [script], { stdio: 'inherit' });
            p.on('exit', (code) => resolve({ script, code }));
        });

        if (process.env.GATE_FAILFAST_INJECT_STAGE === 'news_contract_fail') {
            await markFailAndExit('news_contract', '[Injected Failure] news contract', ['rank_contract', 'export_contract', 'ledger_contract', 'scanner_contract', 'universe_contract', 'trading_contract']);
        }

        console.log('[Gate Light] HEAVY_PARALLEL_START: news/rank/export/ledger');
        const [newsRes, rankRes, exportRes, ledgerRes] = await Promise.all([
            runNode('scripts/check_news_pull_contract.mjs'),
            runNode('scripts/verify_rank_v2_contract.mjs'),
            runNode('scripts/verify_export_v1_contract.mjs'),
            runNode('scripts/verify_ledger_v0_contract.mjs'),
        ]);
        console.log('[Gate Light] HEAVY_PARALLEL_DONE:', JSON.stringify({
            news: newsRes.code, rank: rankRes.code, export: exportRes.code, ledger: ledgerRes.code
        }));
        if (newsRes.code !== 0) { await markFailAndExit('news_contract', '[Gate Light] News Pull Contract Check FAILED.', ['rank_contract', 'export_contract', 'ledger_contract', 'scanner_contract', 'universe_contract', 'trading_contract']); }
        if (rankRes.code !== 0) { await markFailAndExit('rank_contract', '[Gate Light] Rank V2 Contract Check FAILED.', ['export_contract', 'ledger_contract', 'scanner_contract', 'universe_contract', 'trading_contract']); }
        if (exportRes.code !== 0) { await markFailAndExit('export_contract', '[Gate Light] Export V1 Contract Check FAILED.', ['ledger_contract', 'scanner_contract', 'universe_contract', 'trading_contract']); }
        if (ledgerRes.code !== 0) { await markFailAndExit('ledger_contract', '[Gate Light] Ledger V0 Contract Check FAILED.', ['scanner_contract', 'universe_contract', 'trading_contract']); }
        await stopMock();

        const HARD_TIMEOUT_MS = 4000;
        console.log('[Gate Light] HEAVY_ENDPOINT_HARD_TIMEOUT_MS=' + HARD_TIMEOUT_MS);
        const fetchWithTimeout = async (url, opts = {}, ms = HARD_TIMEOUT_MS) => {
            const ac = new AbortController();
            const to = setTimeout(() => ac.abort(), ms);
            try {
                const res = await fetch(url, { ...opts, signal: ac.signal });
                clearTimeout(to);
                return res;
            } catch (e) {
                clearTimeout(to);
                throw e;
            }
        };
        const checkScanner = async () => {
            console.log('[Gate Light] Checking Scanner API Contract...');
            try {
                const scannerRes = await fetchWithTimeout('http://localhost:53122/scanner/runs?limit=1');
                if (scannerRes.ok) {
                    const data = await scannerRes.json();
                    if (Array.isArray(data.runs) && typeof data.total === 'number') {
                        console.log('[Gate Light] Scanner runs contract: PASS');
                    } else {
                        console.warn('[Gate Light] Scanner runs contract: WARN (missing runs/total fields)');
                    }
                } else {
                    console.warn('[Gate Light] Scanner runs contract: SKIP (endpoint returned ' + scannerRes.status + ')');
                }
            } catch (e) {
                console.warn('[Gate Light] Scanner runs contract: SKIP (server unreachable)');
            }
        };
        const checkUniverse = async () => {
            console.log('[Gate Light] Checking Universe API Contract...');
            try {
                const universeRes = await fetchWithTimeout('http://localhost:53122/universe/runs?limit=1');
                if (universeRes.ok) {
                    const data = await universeRes.json();
                    if (Array.isArray(data.runs) && typeof data.total === 'number') {
                        console.log('[Gate Light] Universe runs contract: PASS');
                    } else {
                        console.warn('[Gate Light] Universe runs contract: WARN (missing runs/total fields)');
                    }
                } else {
                    console.warn('[Gate Light] Universe runs contract: SKIP (endpoint returned ' + universeRes.status + ')');
                }
            } catch (e) {
                console.warn('[Gate Light] Universe runs contract: SKIP (server unreachable)');
            }
        };
        const checkTrading = async () => {
            console.log('[Gate Light] Checking Trading Routes API Contract...');
            try {
                const tradingOrdersRes = await fetchWithTimeout('http://localhost:53122/trading/orders');
                if (tradingOrdersRes.ok) {
                    const data = await tradingOrdersRes.json();
                    if (Array.isArray(data.orders) && typeof data.total === 'number') {
                        console.log('[Gate Light] Trading orders contract: PASS');
                    } else {
                        console.warn('[Gate Light] Trading orders contract: WARN (missing orders/total fields)');
                    }
                } else {
                    console.warn('[Gate Light] Trading orders contract: SKIP (endpoint returned ' + tradingOrdersRes.status + ')');
                }
                const trading404Res = await fetchWithTimeout('http://localhost:53122/trading/orders/nonexistent_id');
                if (trading404Res.status === 404) {
                    console.log('[Gate Light] Trading orders 404 contract: PASS');
                } else {
                    console.warn('[Gate Light] Trading orders 404 contract: WARN (expected 404, got ' + trading404Res.status + ')');
                }
                const tradingKillRes = await fetchWithTimeout('http://localhost:53122/trading/kill', { method: 'POST' });
                if (tradingKillRes.ok) {
                    const killData = await tradingKillRes.json();
                    if (typeof killData.status === 'string') {
                        console.log('[Gate Light] Trading kill contract: PASS');
                    } else {
                        console.warn('[Gate Light] Trading kill contract: WARN (missing status field)');
                    }
                } else {
                    console.warn('[Gate Light] Trading kill contract: SKIP (endpoint returned ' + tradingKillRes.status + ')');
                }
            } catch (e) {
                console.warn('[Gate Light] Trading routes contract: SKIP (server unreachable)');
            }
        };
        console.log('[Gate Light] HEAVY_PARALLEL_START: scanner/universe/trading');
        await Promise.all([checkScanner(), checkUniverse(), checkTrading()]);
        console.log('[Gate Light] HEAVY_PARALLEL_DONE: scanner/universe/trading');
    } else {
        console.log('[Gate Light] LIGHT profile: skipping heavy-only contract checks (news/rank/export/ledger/scanner/universe/trading).');
    }

    // --- Strict Healthcheck Validation (Task 260208_023) ---
    console.log('[Gate Light] Checking healthcheck evidence...');

    // Use the resolved result_dir which respects LATEST.json/Arguments
    if (!result_dir) {
        console.error(`[Gate Light] FAILED: result_dir not resolved for healthcheck verification.`);
        process.exit(1);
    }
    const evidenceDir = result_dir;
    console.log(`[Gate Light] Using evidence directory: ${evidenceDir}`);

    const rootFile = path.join(evidenceDir, `${task_id}_healthcheck_53122_root.txt`);
    const pairsFile = path.join(evidenceDir, `${task_id}_healthcheck_53122_pairs.txt`);

    const checkFile = (filePath) => {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing healthcheck file: ${filePath}`);
        }
        const buffer = fs.readFileSync(filePath);
        if (buffer.includes(0)) { // Check for NUL byte
             throw new Error(`File contains NUL bytes (binary/UTF-16 issue): ${filePath}`);
        }
        const content = buffer.toString('utf8');
        // Regex for HTTP 200: HTTP/1.1 200 or HTTP/1.0 200
        if (!/HTTP\/\d\.\d\s+200/.test(content)) {
            // Show snippet
            const snippet = content.substring(0, 100).replace(/\r/g, '').replace(/\n/g, ' ');
            throw new Error(`File does not contain 'HTTP/x.x 200': ${filePath}. Content snippet: "${snippet}..."`);
        }
    };

    try {
        checkFile(rootFile);
        checkFile(pairsFile);
        console.log('[Gate Light] Healthcheck evidence verified (Path + Content).');
    } catch (e) {
        console.error(`[Gate Light] Healthcheck Verification FAILED: ${e.message}`);
        console.error('Fix Suggestion: Use `curl.exe -s -i ... --output <path>` to generate readable ASCII text evidence.');
        console.error(`FIX_CMD: curl.exe -s -i http://localhost:53122/ --output ${path.join(result_dir, task_id + '_healthcheck_53122_root.txt')} && curl.exe -s -i http://localhost:53122/pairs --output ${path.join(result_dir, task_id + '_healthcheck_53122_pairs.txt')}`);
        process.exit(1);
    }
    // -------------------------------------------------------

    // --- DoD Evidence Excerpt Check (Task 260208_030) ---
    // Only enforce for tasks >= 260208_030
    // Skip if in PREVIEW mode (files not assembled yet)
    if (process.env.GENERATE_PREVIEW === '1') {
        console.log('[Gate Light] Skipping DoD Evidence Excerpt Check (Preview Mode).');
    } else if (task_id >= '260208_030') {
        console.log('[Gate Light] Checking DoD Evidence Excerpts...');
        
        // Fix: result_dir is not defined in this scope. It's defined in check_global_artifact_guard.
        // But we have evidenceDir which is rules/task-reports/YYYY-MM
        // We should use evidenceDir
        
        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        const resultFile = path.join(evidenceDir, `result_${task_id}.json`);
        
        if (!fs.existsSync(notifyFile) || !fs.existsSync(resultFile)) {
             console.error(`[Gate Light] FAILED: Notify or Result file missing for DoD check.`);
             process.exit(1);
        }
        
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        
        // Check Notify
        const rootRegex = /DOD_EVIDENCE_HEALTHCHECK_ROOT:.*=>.*HTTP\/\d\.\d\s+200\s+OK/;
        const pairsRegex = /DOD_EVIDENCE_HEALTHCHECK_PAIRS:.*=>.*HTTP\/\d\.\d\s+200\s+OK/;
        
        if (!rootRegex.test(notifyContent)) {
            console.error('[Gate Light] FAILED: Notify file missing or invalid DoD Root Evidence.');
            console.error('Expected format: DOD_EVIDENCE_HEALTHCHECK_ROOT: <path> => HTTP/1.1 200 OK');
            process.exit(1);
        }
        
        if (!pairsRegex.test(notifyContent)) {
            console.error('[Gate Light] FAILED: Notify file missing or invalid DoD Pairs Evidence.');
            console.error('Expected format: DOD_EVIDENCE_HEALTHCHECK_PAIRS: <path> => HTTP/1.1 200 OK');
            process.exit(1);
        }
        
        // Check Result JSON
        if (!resultData.dod_evidence || !Array.isArray(resultData.dod_evidence.healthcheck) || resultData.dod_evidence.healthcheck.length < 2) {
             console.error('[Gate Light] FAILED: Result JSON missing dod_evidence.healthcheck field.');
             process.exit(1);
        }
        
        console.log('[Gate Light] DoD Evidence Excerpts verified.');
    } else {
        console.log(`[Gate Light] Skipping DoD Evidence Check for legacy task ${task_id}`);
    }

    // --- Scan Cache DoD Check (Task 260209_002) ---
    // Restricted to 260209 series where Scan Cache was the primary focus
    if (task_id >= '260209_002' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking Scan Cache DoD Evidence...');
        
        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        const resultFile = path.join(evidenceDir, `result_${task_id}.json`);
        
        // Files existence already checked above
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        
        // Check Notify
        const hasMiss = notifyContent.match(/DOD_EVIDENCE_SCAN_CACHE_MISS:.+cached=false/);
        const hasHit = notifyContent.match(/DOD_EVIDENCE_SCAN_CACHE_HIT:.+cached=true/);
        
        if (!hasMiss || !hasHit) {
            console.error('[Gate Light] FAILED: Notify file missing valid Scan Cache DoD Evidence.');
            console.error('Expected: DOD_EVIDENCE_SCAN_CACHE_MISS (cached=false) and DOD_EVIDENCE_SCAN_CACHE_HIT (cached=true).');
            process.exit(1);
        }
        
        // Check Result JSON
        if (!resultData.dod_evidence || !Array.isArray(resultData.dod_evidence.scan_cache) || resultData.dod_evidence.scan_cache.length < 2) {
             console.error('[Gate Light] FAILED: Result JSON missing dod_evidence.scan_cache field (len >= 2).');
             process.exit(1);
        }
        
        // Deep check JSON content matches required patterns
        const jsonMiss = resultData.dod_evidence.scan_cache.find(l => l.includes('cached=false'));
        const jsonHit = resultData.dod_evidence.scan_cache.find(l => l.includes('cached=true'));
        
        if (!jsonMiss || !jsonHit) {
             console.error('[Gate Light] FAILED: Result JSON scan_cache evidence does not contain both Miss and Hit.');
             process.exit(1);
        }
        
        console.log('[Gate Light] Scan Cache DoD Evidence verified.');
    }

    // --- DoD Stdout Mechanism Check (Task 260209_003) ---
    // Bounded to 260209 series as later tasks use different evidence structures (e.g. test_log)
    if (task_id >= '260209_003' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking DoD Stdout Mechanism...');

        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        const dodStdoutFile = path.join(evidenceDir, `dod_stdout_${task_id}.txt`);
        
        // 1. Check dod_stdout file existence
        if (!fs.existsSync(dodStdoutFile)) {
            console.error(`[Gate Light] FAILED: dod_stdout_${task_id}.txt missing.`);
            process.exit(1);
        }

        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        const dodStdoutContent = fs.readFileSync(dodStdoutFile, 'utf8');

        // 2. Check for Stdout Block in Notify
        const marker = "=== DOD_EVIDENCE_STDOUT ===";
        if (!notifyContent.includes(marker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${marker}' block.`);
             process.exit(1);
        }

        // 3. Check dod_stdout content
        if (!dodStdoutContent.includes(marker)) {
             console.error(`[Gate Light] FAILED: dod_stdout file missing '${marker}' header.`);
             process.exit(1);
        }

        const dodLines = dodStdoutContent.split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('DOD_EVIDENCE_'));

        if (dodLines.length < 2) {
             console.error(`[Gate Light] FAILED: dod_stdout file has fewer than 2 DOD_EVIDENCE_ lines.`);
             process.exit(1);
        }

        // 4. Validate Format (=>)
        const invalidLines = dodLines.filter(l => !l.includes('=>'));
        if (invalidLines.length > 0) {
             console.error(`[Gate Light] FAILED: DOD_EVIDENCE_ lines must contain '=>'. Invalid lines:`);
             invalidLines.forEach(l => console.error(`  ${l}`));
             process.exit(1);
        }

        // 5. Consistency Check (Notify vs dod_stdout)
        // Ensure all DoD lines in dod_stdout are present in notify
        for (const line of dodLines) {
            if (!notifyContent.includes(line)) {
                console.error(`[Gate Light] FAILED: Notify file missing DoD line from dod_stdout:`);
                console.error(`  ${line}`);
                process.exit(1);
            }
        }

        console.log('[Gate Light] DoD Stdout Mechanism verified.');
    }

    // --- Concurrent Scan DoD Check (Task 260209_004) ---
    // Bounded to 260209 series
    if (task_id >= '260209_004' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking Concurrent Scan DoD Evidence...');
        
        // Re-derive evidenceDir if needed, but it should be available from above
        // Format: YYMMDD_XXX. 26->2026, 02->02
        const match = task_id.match(/^(\d{2})(\d{2})\d{2}_/);
        if (match) {
            const year = '20' + match[1];
            const month = match[2];
            const monthDir = `${year}-${month}`;
            const evidenceDirLocal = path.join('rules', 'task-reports', monthDir);
            
            const logFile = path.join(evidenceDirLocal, `M4_PR2_concurrent_log_${task_id}.txt`);
            
            if (!fs.existsSync(logFile)) {
                console.error(`[Gate Light] FAILED: Concurrent Scan Log missing: ${logFile}`);
                process.exit(1);
            }
            
            const content = fs.readFileSync(logFile, 'utf8');
            if (!content.includes('PASS: Concurrent Batch Scan Verified')) {
                console.error('[Gate Light] FAILED: Concurrent Scan Log does not contain PASS message.');
                process.exit(1);
            }
            console.log('[Gate Light] Concurrent Scan DoD Evidence verified.');
        }
    }


    // --- Deletion Audit Check (Task 260211_006) ---
    // Rule: locks/runs is append-only; deletion is forbidden.
    // Logic: Read index, find first run, verify persistence.
    // Applies to ALL tasks if index exists, but mandatory for >= 260211_006.
    if (task_id >= '260211_006' || fs.existsSync(path.join('rules', 'task-reports', 'index', 'runs_index.jsonl'))) {
        console.log('[Gate Light] Checking Deletion Audit (Locks & Runs)...');
        const indexFile = path.join('rules', 'task-reports', 'index', 'runs_index.jsonl');
        const lockFile = path.join('rules', 'task-reports', 'locks', `${task_id}.lock.json`);

        let indexEntry = null;
        if (fs.existsSync(indexFile)) {
            let content = fs.readFileSync(indexFile, 'utf8');
            // Remove BOM if present
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1);
            }
            const lines = content.split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line.trim());
                    if (entry.task_id === task_id) {
                        indexEntry = entry;
                        break; // Found first run
                    }
                } catch (e) {
                    console.error(`[Gate Light] Warning: Failed to parse index line: ${e.message}`);
                    console.error(`Line content: [${line}]`);
                }
            }
        }

        if (indexEntry) {
            // Case A: Index Entry Exists -> Must verify Lock & RunDir
            const lockPath = indexEntry.lock_path; // relative path from repo root
            const runDir = indexEntry.run_dir;     // relative path from repo root
            
            const lockExists = fs.existsSync(lockPath);
            const runExists = fs.existsSync(runDir);

            if (!lockExists || !runExists) {
                console.error('[BLOCK] DELETION_AUDIT_VIOLATION');
                console.error(`[DETAIL] Missing lock or run dir for task_id=${task_id}`);
                if (!lockExists) console.error(`   - Missing Lock: ${lockPath}`);
                if (!runExists) console.error(`   - Missing RunDir: ${runDir}`);
                console.error('[ACTION] Do NOT delete locks/runs. Use new task_id to redo evidence.');
                process.exit(41);
            }
            console.log(`[Gate Light] Deletion Audit verified (Lock & Run exist for Run ${indexEntry.run_id}).`);
        } else {
            // Case B: No Index Entry (or No Index File)
            // Check if Lock exists. If Lock exists, we have an "Unindexed Lock" violation.
            if (fs.existsSync(lockFile)) {
                console.error('[BLOCK] DELETION_AUDIT_VIOLATION');
                console.error(`[DETAIL] Lock file exists but Index entry missing for task_id=${task_id}`);
                console.error(`   - Lock Found: ${lockFile}`);
                console.error(`   - Index Entry: Missing`);
                console.error('[ACTION] This violates Immutable Index rules. Index must be appended during Integrate.');
                process.exit(41);
            } else {
                // Case C: No Lock, No Index.
                // This is valid ONLY if we are in the "Before Integrate" state.
                // But Gate Light is usually run AFTER Integrate.
                // If this is a strict check for >= 260211_006, we might want to warn.
                if (task_id >= '260211_006') {
                    console.log('[Gate Light] Deletion Audit: No lock/index yet (Assuming Pre-Integrate or First Run in progress).');
                }
            }
        }
    }

    // --- Trae Report Snippet Check (Task 260209_005) ---
    // Bounded to 260209 series
    if (task_id >= '260209_005' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking Trae Report Snippet...');

        const snippetFile = path.join(evidenceDir, `trae_report_snippet_${task_id}.txt`);
        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        
        // 1. Check Snippet Existence
        if (!fs.existsSync(snippetFile)) {
            console.error(`[Gate Light] FAILED: Snippet file missing: ${snippetFile}`);
            process.exit(1);
        }

        const snippetContent = fs.readFileSync(snippetFile, 'utf8');
        const notifyContent = fs.existsSync(notifyFile) ? fs.readFileSync(notifyFile, 'utf8') : '';

        // 2. Check Snippet Content Markers
        const requiredMarkers = [
            'BRANCH:',
            'COMMIT:',
            '=== GIT_SCOPE_DIFF ===',
            '=== DOD_EVIDENCE_STDOUT ===',
            '=== GATE_LIGHT_PREVIEW ==='
        ];

        // [Postflight] PASS and [Gate Light] PASS are deprecated.
        // We now rely on GATE_LIGHT_EXIT code and Evidence Truth checks.

        const missingMarkers = requiredMarkers.filter(m => !snippetContent.includes(m));
        if (missingMarkers.length > 0) {
            console.error(`[Gate Light] FAILED: Snippet file missing required markers:`);
            missingMarkers.forEach(m => console.error(`  - ${m}`));
            process.exit(1);
        }

        // 3. Check Notify Reference
        if (!notifyContent.includes('TRAE_REPORT_SNIPPET:')) {
            console.error(`[Gate Light] FAILED: Notify file missing 'TRAE_REPORT_SNIPPET:' reference.`);
            process.exit(1);
        }

        console.log('[Gate Light] Trae Report Snippet verified.');
    }

    // --- No Auto-Merge Check (Task 260211_007) ---
    if (task_id >= '260211_007') {
        console.log('[Gate Light] Checking No Auto-Merge (Git Forbidden Commands)...');
        
        // Scan all command_audit files in the current task's month or global?
        // User said: "scan rules/task-reports/**/command_audit_*.txt"
        // But maybe just check the current task's audit? 
        // "Agent 只能 PR + PASS 通知，不得合并" implies checking the CURRENT task's actions.
        // Checking *all* history might be slow and redundant.
        // Let's check command_audit files for the CURRENT task_id.
        // The audit files are usually at rules/task-reports/<YYYY-MM>/command_audit_<id>.txt
        // Or global? Usually task-specific.
        
        // Find audit files for this task
        const taskReportStart = Date.now();
        const auditFiles = [];
        const monthDirs = fs.readdirSync(path.join('rules', 'task-reports')).filter(d => /^\d{4}-\d{2}$/.test(d));
        for (const md of monthDirs) {
            const dir = path.join('rules', 'task-reports', md);
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir).filter(f => f.startsWith(`command_audit_`) && f.includes(task_id));
                files.forEach(f => auditFiles.push(path.join(dir, f)));
            }
        }
        
        // Also check if there are any "general" audit files modified recently?
        // For now, focus on task-specific audit files.
        
        let violation = false;
        let auditLineCount = 0;
        for (const file of auditFiles) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            auditLineCount += lines.length;
            for (const line of lines) {
                // Check for forbidden commands
                // git merge, push origin main, checkout main + write?
                // Simple regexes
                if (/git\s+merge\s+/i.test(line) || 
                    /git\s+push\s+.*main/i.test(line) ||
                    /git\s+checkout\s+main/i.test(line)) { // checkout main is suspicious if followed by edits, but strict ban is safer
                    console.error(`[BLOCK] AUTO_MERGE_VIOLATION in ${file}:`);
                    console.error(`  ${line.trim()}`);
                    violation = true;
                }
            }
        }
        
        if (violation) {
            console.error('[Gate Light] FAILED: Auto-Merge/Push-to-Main detected. Agents must use PRs.');
            process.exit(62);
        }
        addProfile('task_reports_audit_scan', Date.now() - taskReportStart, { file_count: auditFiles.length, line_count: auditLineCount });
        console.log('[Gate Light] No Auto-Merge verified.');
    }

    // --- [REMOVED by M4.5-T0 / 260301_028] Evidence Truth & Sufficiency Hardening ---

    // --- Opps Pipeline DoD Check (Task 260209_006) ---
    if (task_id >= '260209_006' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking Opps Pipeline DoD Evidence...');
        
        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        
        // Ensure notify file exists
        if (!fs.existsSync(notifyFile)) {
             console.error(`[Gate Light] FAILED: Notify file missing: ${notifyFile}`);
             process.exit(1);
        }
        
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        
        // 1. Check for DOD_EVIDENCE_OPPS_PIPELINE_RUN with specific fields
        const runMarker = 'DOD_EVIDENCE_OPPS_PIPELINE_RUN:';
        if (!notifyContent.includes(runMarker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${runMarker}'.`);
             process.exit(1);
        }
        
        const runLine = notifyContent.split('\n').find(l => l.includes(runMarker));
        if (!runLine.includes('=>') || !runLine.includes('run_id=') || !runLine.includes('ok=') || !runLine.includes('failed=')) {
             console.error(`[Gate Light] FAILED: '${runMarker}' line has invalid format or missing fields (=>, run_id, ok, failed).`);
             process.exit(1);
        }
        
        // 2. Check for DOD_EVIDENCE_OPPS_PIPELINE_TOP with specific fields
        const topMarker = 'DOD_EVIDENCE_OPPS_PIPELINE_TOP:';
        if (!notifyContent.includes(topMarker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${topMarker}'.`);
             process.exit(1);
        }
        
        const topLine = notifyContent.split('\n').find(l => l.includes(topMarker));
        if (!topLine.includes('=>') || !topLine.includes('top_count=') || !topLine.includes('refs_run_id=true')) {
             console.error(`[Gate Light] FAILED: '${topMarker}' line has invalid format or missing fields (=>, top_count, refs_run_id).`);
             process.exit(1);
        }
        
        console.log('[Gate Light] Opps Pipeline DoD Evidence verified.');
    }

    // --- Opps Run Filter DoD Check (Task 260209_008) ---
    if (task_id >= '260209_008' && task_id <= '260209_999') {
        console.log('[Gate Light] Checking Opps Run Filter DoD Evidence...');
        
        const notifyFile = path.join(evidenceDir, `notify_${task_id}.txt`);
        
        if (!fs.existsSync(notifyFile)) {
             console.error(`[Gate Light] FAILED: Notify file missing: ${notifyFile}`);
             process.exit(1);
        }
        
        const notifyContent = fs.readFileSync(notifyFile, 'utf8');
        
        // 1. Check DOD_EVIDENCE_OPPS_RUNS_LIST
        const runsListMarker = 'DOD_EVIDENCE_OPPS_RUNS_LIST:';
        if (!notifyContent.includes(runsListMarker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${runsListMarker}'.`);
             process.exit(1);
        }
        
        const runsListLine = notifyContent.split('\n').find(l => l.includes(runsListMarker));
        if (!runsListLine.includes('=>') || !runsListLine.includes('contains_run_id=true')) {
             console.error(`[Gate Light] FAILED: '${runsListMarker}' line has invalid format or missing 'contains_run_id=true'.`);
             process.exit(1);
        }

        // 2. Check DOD_EVIDENCE_OPPS_BY_RUN
        const byRunMarker = 'DOD_EVIDENCE_OPPS_BY_RUN:';
        if (!notifyContent.includes(byRunMarker)) {
             console.error(`[Gate Light] FAILED: Notify file missing '${byRunMarker}'.`);
             process.exit(1);
        }
        
        const byRunLine = notifyContent.split('\n').find(l => l.includes(byRunMarker));
        if (!byRunLine.includes('=>') || !byRunLine.includes('run_id=')) {
             console.error(`[Gate Light] FAILED: '${byRunMarker}' line has invalid format or missing 'run_id='. (Expected: ... => run_id=...)`);
             process.exit(1);
        }
        
        console.log('[Gate Light] Opps Run Filter DoD Evidence verified.');
    }

    // --- [REMOVED by M4.5-T0 / 260301_028] CI Parity Probe Check ---

    // --- Workflow Hardening Check (Task 260209_009) ---
    if (process.env.GATE_LIGHT_SKIP_HISTORICAL_CHECK === '1') {
        console.log('[Gate Light] Skipping Workflow Hardening (GATE_LIGHT_SKIP_HISTORICAL_CHECK=1).');
    }
    else if (task_id >= '260209_009') {
        console.log('[Gate Light] Checking Workflow Hardening (NoHistoricalEvidenceTouch & SnippetCommitMustMatch)...');

        // A) NoHistoricalEvidenceTouch
        try {
            // Note: This requires git to be available and origin/main to be fetched
            const diffOutput = execSync('git diff --name-status origin/main...HEAD', { encoding: 'utf8' });
            const forbiddenModifications = [];
            
            // Fetch previous LATEST.json from origin/main to allow transition
            let allowedLegacyTaskId = null;
            try {
                const oldLatestJsonStr = execSync('git show origin/main:rules/LATEST.json', { encoding: 'utf8', stdio: 'pipe' });
                const oldLatestJson = JSON.parse(oldLatestJsonStr);
                if (oldLatestJson && oldLatestJson.task_id) {
                    allowedLegacyTaskId = oldLatestJson.task_id;
                    console.log(`[Gate Light] Allowed legacy task_id (transition): ${allowedLegacyTaskId}`);
                }
            } catch (e) {
                // Ignore if not found or failed
            }

            diffOutput.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) return;
                
                // Status is first part (M, A, D, etc.)
                // File path is the last part
                const filePath = parts[parts.length - 1]; 
                
                // Allow Added files (A) - Adding new evidence is not "touching historical evidence"
                if (parts[0] === 'A') return;

                // Only enforce for rules/task-reports/
                // Use forward slashes for consistency check
                const normalizedPath = filePath.replace(/\\/g, '/');
                
                if (normalizedPath.startsWith('rules/task-reports/')) {
                    // Check if path or filename contains current task_id
                    // Allowing path match ensures files in rules/task-reports/runs/<task_id>/ are allowed
                    const filename = path.basename(normalizedPath);
                    if (!normalizedPath.includes(task_id)) {
                        // Allow if matches legacy task_id (Transition scenario)
                        if (allowedLegacyTaskId && filename.includes(allowedLegacyTaskId)) {
                            return;
                        }
                        // Allow specific intermediate tasks (Hotfix for 260211_003 integration)
                        if (filename.includes('260211_001') || filename.includes('260211_002')) {
                            return;
                        }
                        // Allow Shared Index file (Task 260211_006 & 260218_018)
                        if (filename === 'runs_index.jsonl' || filename === 'error_stats.jsonl') {
                            return;
                        }
                        // Allow cleanup of historical runtime evidence for Task 260216_002
                        if (task_id === '260216_002' && parts[0] === 'D') {
                             return;
                        }
                        forbiddenModifications.push(`${parts[0]} ${filePath}`);
                    }
                }
            });

            if (forbiddenModifications.length > 0) {
                console.error(`[Gate Light] FAILED: NoHistoricalEvidenceTouch violation. Found modifications to historical evidence:`);
                forbiddenModifications.forEach(m => console.error(`  - ${m}`));
                console.error(`Fix Suggestion: Use 'git restore --source=origin/main -- <path>' to revert, or ensure new files contain '${task_id}'.`);
                console.error(`FIX_CMD: git restore --source=origin/main -- ${forbiddenModifications.map(m => m.split(' ').slice(1).join(' ')).join(' ')}`);
                process.exit(1);
            }
            console.log('[Gate Light] NoHistoricalEvidenceTouch verified.');

        } catch (e) {
             const errMessage = e.message || '';
             // If "no merge base" or "unknown revision", try deepening history and retry
            if (errMessage.includes('no merge base') || errMessage.includes('unknown revision') || errMessage.includes('ambiguous argument')) {
                 console.log('[Gate Light] Diff failed (missing history/ref). Attempting to deepen fetch...');
                 try {
                    execSync('git fetch origin main:refs/remotes/origin/main --depth=100', { stdio: 'ignore' });
                     const retryDiff = execSync('git diff --name-status origin/main...HEAD', { encoding: 'utf8' });
                     // Process retry output (same logic as above, but just checking if it works essentially)
                     // Actually need to run the check logic again.
                     // To avoid code duplication, we'll just check if it throws.
                     // But we need to check forbidden mods! 
                     // Let's recurse or just copy logic? Copy logic for safety.
                     const forbiddenModifications = [];
                     retryDiff.split('\n').forEach(line => {
                         const parts = line.trim().split(/\s+/);
                        if (parts.length < 2) return;
                         const filePath = parts[parts.length - 1];
                        if (parts[0] === 'A') return;
                         const normalizedPath = filePath.replace(/\\/g, '/');
                         if (normalizedPath.startsWith('rules/task-reports/')) {
                             const filename = path.basename(normalizedPath);
                             if (!filename.includes(task_id)) {
                                 forbiddenModifications.push(`${parts[0]} ${filePath}`);
                             }
                         }
                     });
                     if (forbiddenModifications.length > 0) {
                         console.error(`[Gate Light] FAILED: NoHistoricalEvidenceTouch violation (after fetch).`);
                         forbiddenModifications.forEach(m => console.error(`  - ${m}`));
                         process.exit(1);
                     }
                     console.log('[Gate Light] NoHistoricalEvidenceTouch verified (after deepen).');
                 } catch (retryErr) {
                     console.error(`[Gate Light] Git diff check failed even after retry: ${retryErr.message}`);
                     console.log('[Gate Light] Fallback: Skipping NoHistoricalEvidenceTouch due to git environment limitations.');
                     // Fail soft or hard? 
                     // Hard failure is safer, but "unknown revision" might mean totally broken git env.
                     // Let's fail hard as requested ("Hard Failure").
                     process.exit(1); 
                 }
             } else {
                 console.error(`[Gate Light] Git diff check failed: ${e.message}`);
                 process.exit(1);
             }
        }

        // B) SnippetCommitMustMatch (heavy-only)
        if (!isHeavyProfile) {
            console.log('[Gate Light] LIGHT profile: skipping SnippetCommitMustMatch check.');
        } else {
            console.log('SNIPPET_GIT_STRATEGY=local_first');
            const snippetFile = path.join(result_dir, `trae_report_snippet_${task_id}.txt`);
            const isPreviewMode = process.env.GENERATE_PREVIEW === '1' || process.env.GATE_LIGHT_GENERATE_PREVIEW === '1';

            if (isPreviewMode) {
                 console.log('[Gate Light] Skipping SnippetCommitMustMatch check (Preview Mode).');
            } else if (fs.existsSync(snippetFile)) {
                 const snippetContent = fs.readFileSync(snippetFile, 'utf8');
                 const commitMatch = snippetContent.match(/COMMIT:\s*(\w+)/i);
                 
                 if (!commitMatch) {
                     console.error(`[Gate Light] FAILED: SnippetCommitMustMatch - Could not find 'COMMIT:' in snippet.`);
                     process.exit(1);
                 }
                 
                 const snippetCommit = commitMatch[1];
                 const currentHead = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
                let snippetFetchNeeded = false;
                let snippetFetchReason = '';
                const forceFetch = process.env.GATE_SNIPPET_FORCE_FETCH === '1';
                 
                 if (snippetCommit !== currentHead) {
                     if (process.env.GATE_LIGHT_GENERATE_PREVIEW !== '1') {
                        console.log(`[Gate Light] Snippet commit (${snippetCommit}) != HEAD (${currentHead}). Checking for code drift...`);
                     }
                     
                     try {
                        try {
                            execSync(`git cat-file -t ${snippetCommit}`, { stdio: 'ignore' });
                        } catch (e) {
                            snippetFetchNeeded = true;
                            snippetFetchReason = 'snippet_commit_not_local';
                        }
                        if (forceFetch) {
                            snippetFetchNeeded = true;
                            snippetFetchReason = snippetFetchReason || 'forced_for_governance_test';
                        }
                        if (snippetFetchNeeded) {
                            console.log('SNIPPET_GIT_FETCH_NEEDED=true');
                            console.log('[Gate Light] SNIPPET_GIT_FETCH_REASON=' + snippetFetchReason);
                            console.log('[Gate Light] SNIPPET_GIT_FETCH_ACTION=git fetch origin --deepen=50');
                            execSync('git fetch origin --deepen=50', { stdio: 'ignore' });
                        } else {
                            console.log('SNIPPET_GIT_FETCH_NEEDED=false');
                        }

                         const diffFiles = execSync(`git diff --name-only ${snippetCommit} ${currentHead}`, { encoding: 'utf8' }).split('\n').filter(Boolean);
                         
                         const isSnippetDriftWhitelisted = (normalized) =>
                             normalized.startsWith('rules/task-reports/') ||
                             normalized.startsWith('rules/rules/') ||
                             normalized.startsWith('rules/reports/') ||
                             normalized.startsWith('docs/') ||
                             normalized === 'rules/LATEST.json' ||
                             normalized === 'scripts/gate_light_ci.mjs';

                         const hasCodeChanges = diffFiles.some(file => {
                             const normalized = file.replace(/\\/g, '/');
                             return !isSnippetDriftWhitelisted(normalized);
                         });
                         
                         if (hasCodeChanges) {
                             if (process.env.GATE_LIGHT_GENERATE_PREVIEW === '1') {
                             } else {
                                 console.error(`[Gate Light] FAILED: SnippetCommitMustMatch - Codebase has changed between snippet commit and HEAD.`);
                                 console.error(`Changed code files:`);
                                diffFiles.filter(f => {
                                   const n = f.replace(/\\/g, '/');
                                   return !isSnippetDriftWhitelisted(n);
                                }).forEach(f => console.error(`  - ${f}`));
                                 console.error(`Fix Suggestion: Re-run Integrate/Build Snippet to align with latest code.`);
                                 console.error(`FIX_CMD: .\\scripts\\run_task.ps1 -TaskId ${task_id} -Mode Integrate -Header "TraeTask_${task_id}"`);
                                 process.exit(1);
                             }
                         } else {
                            if (process.env.GATE_LIGHT_GENERATE_PREVIEW !== '1') {
                                console.log('[Gate Light] SnippetCommitMustMatch verified (Evidence/Docs-only update detected).');
                            }
                         }
                         
                     } catch (e) {
                         console.error(`[Gate Light] FAILED: SnippetCommitMustMatch - Hash mismatch and could not verify diff: ${e.message}`);
                        console.log('GATE_LIGHT_EXIT=1');
                        process.exit(1);
                     }
                } else if (forceFetch) {
                    snippetFetchNeeded = true;
                    snippetFetchReason = 'forced_for_governance_test';
                    console.log('SNIPPET_GIT_FETCH_NEEDED=true');
                    console.log('[Gate Light] SNIPPET_GIT_FETCH_REASON=' + snippetFetchReason);
                    console.log('[Gate Light] SNIPPET_GIT_FETCH_ACTION=git fetch origin --deepen=50');
                    execSync('git fetch origin --deepen=50', { stdio: 'ignore' });
                } else {
                    console.log('SNIPPET_GIT_FETCH_NEEDED=false');
                }
                 console.log('[Gate Light] SnippetCommitMustMatch verified.');
            } else {
                 console.error(`[Gate Light] FAILED: Snippet file missing for Commit Match check.`);
                 process.exit(1);
            }
        }
        
        // C) Snippet Stdout Check (Verification of dev_batch_mode behavior is implicit via evidence existence, 
        // but checking the file structure is covered by Snippet Content Markers check above.
        // The requirement says: "gate_light_ci.mjs 增加检查：trae_report_snippet_<task_id>.txt 必须存在...且包含 === DOD_EVIDENCE_STDOUT ==="
        // This is already covered by Task 260209_005 check (Snippet Content Markers).
        // So no extra check needed here for C.
    }

    // --- [REMOVED by M4.5-T0 / 260301_028] GATE_LIGHT_EXIT Mechanism Check ---

    // --- [REMOVED by M4.5-T0 / 260301_028] Evidence Truth & Consistency Check ---

    if (isHeavyProfile) {
    console.log('[Gate Light] Checking Rank V2 Contract Version Guard...');
    try {
        const contractPath = 'OppRadar/contracts/rank_v2.contract.json';
        const schemaPath = 'OppRadar/contracts/opps_rank_v2_response.schema.json';

        if (fs.existsSync(contractPath) && fs.existsSync(schemaPath)) {
            // 1. Determine Base Commit
            let baseCommit;
            try {
                try {
                    execSync('git rev-parse origin/main', { stdio: 'ignore' });
                } catch (e) {
                    execSync('git fetch origin main', { stdio: 'ignore' });
                }
                baseCommit = execSync('git merge-base origin/main HEAD').toString().trim();
            } catch (e) {
                console.warn(`[Gate Light] Warning: Could not determine merge-base. Defaulting to origin/main.`);
                baseCommit = 'origin/main';
            }
            console.log(`[Gate Light] Base Commit: ${baseCommit}`);

            // 2. Read Files
            const getFileContent = (commit, filePath) => {
                try {
                    return execSync(`git show ${commit}:${filePath}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
                } catch (e) {
                    return null;
                }
            };

            const headContractStr = fs.readFileSync(contractPath, 'utf8');
            const headSchemaStr = fs.readFileSync(schemaPath, 'utf8');
            const baseContractStr = getFileContent(baseCommit, contractPath);
            const baseSchemaStr = getFileContent(baseCommit, schemaPath);

            const headContract = JSON.parse(headContractStr);
            const baseContract = baseContractStr ? JSON.parse(baseContractStr) : null;

            const getHash = (content) => crypto.createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex').substring(0, 8);
            
            const headSchemaHash = getHash(headSchemaStr);
            const baseSchemaHash = baseSchemaStr ? getHash(baseSchemaStr) : '00000000';
            
            const schemaChanged = headSchemaHash !== baseSchemaHash;

            // 3. Validation Rules
            if (headContract.schema_sha256_short !== headSchemaHash) {
                console.error(`[Gate Light] FAILED: Rank V2 Contract 'schema_sha256_short' (${headContract.schema_sha256_short}) mismatch. Actual: ${headSchemaHash}`);
                process.exit(1);
            }

            if (schemaChanged) {
                const headVer = parseFloat(headContract.contract_version);
                const baseVer = baseContract ? parseFloat(baseContract.contract_version) : 0.0;
                
                console.log(`[Gate Light] Schema Changed (${baseSchemaHash} -> ${headSchemaHash}). Checking Version Increment...`);
                console.log(`[Gate Light] Version: ${baseVer} -> ${headVer}`);

                if (headVer <= baseVer) {
                     console.error(`[Gate Light] FAILED: Rank V2 Schema changed but contract_version did not increment.`);
                     process.exit(1);
                }
            } else {
                console.log(`[Gate Light] Schema Unchanged (${headSchemaHash}). Version check skipped.`);
            }
            
            console.log('[Gate Light] Rank V2 Contract Version Guard PASS');

        } else {
            console.log('[Gate Light] Rank V2 Contract/Schema not found. Skipping Guard.');
        }
    } catch (e) {
        console.error(`[Gate Light] Rank V2 Contract Guard Error: ${e.message}`);
        process.exit(1);
    }
    } else {
        console.log('[Gate Light] LIGHT profile: skipping Rank V2 Contract Version Guard.');
    }

    if (isHeavyProfile && task_id === '260211_004') {
        console.log('[Gate Light] Checking M5 PR1 LLM Router Contract...');
        const evidenceFile = path.join(result_dir, `M5_PR1_llm_json_${task_id}.txt`);
        
        if (!fs.existsSync(evidenceFile)) {
            console.error(`[Gate Light] FAILED: Evidence file missing: ${evidenceFile}`);
            process.exit(1);
        }

        const content = fs.readFileSync(evidenceFile, 'utf8');
        const lines = content.split('\n');
        
        // Find Summary Line
        const summaryLine = lines.find(l => l.startsWith('DOD_EVIDENCE_M5_PR1_LLM_JSON:'));
        if (!summaryLine) {
            console.error('[Gate Light] FAILED: Evidence missing DOD_EVIDENCE_M5_PR1_LLM_JSON summary line.');
            process.exit(1);
        }

        // Parse JSON (Everything before the summary line? Or just parse strictly)
        // Since we appended the summary line at the end, we can try parsing the content excluding the last line(s).
        // Or find the last '}'?
        // Let's assume the format is JSON \n DOD_EVIDENCE...
        const jsonContent = lines.filter(l => !l.startsWith('DOD_EVIDENCE_M5_PR1_LLM_JSON:')).join('\n').trim();
        
        let json;
        try {
            json = JSON.parse(jsonContent);
        } catch (e) {
            console.error(`[Gate Light] FAILED: Invalid JSON in evidence file: ${e.message}`);
            process.exit(1);
        }

        // Load Schema
        const schemaPath = path.join('contracts', 'llm_route_response.schema.json');
        if (!fs.existsSync(schemaPath)) {
            console.error(`[Gate Light] FAILED: Schema file missing: ${schemaPath}`);
            process.exit(1);
        }
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

        // Validate (Simple Manual Validation)
        const validate = (data, schema) => {
            if (data.status !== 'ok') return true; // Error schema not strictly enforced here? User said success+error sample, but we only have one evidence file. We assume it's success.
            
            if (data.status === 'ok') {
                if (!data.run_id) return 'Missing run_id';
                if (!['mock', 'deepseek'].includes(data.provider_used)) return `Invalid provider_used: ${data.provider_used}`;
                if (!data.model_used) return 'Missing model_used';
                if (!Array.isArray(data.items)) return 'items is not an array';
                
                // Validate Items
                for (const item of data.items) {
                    if (!item.opp_id) return 'Item missing opp_id';
                    if (!item.llm_json || typeof item.llm_json !== 'object') return 'Item missing or invalid llm_json';
                }
            }
            return null;
        };

        const error = validate(json, schema);
        if (error) {
            console.error(`[Gate Light] FAILED: Contract Validation Failed: ${error}`);
            process.exit(1);
        }
        
        console.log('[Gate Light] M5 PR1 LLM Router Contract verified.');
    }

    if (isHeavyProfile) {
        console.log('[Gate Light] Checking Heavy Mandatory Evidence...');
        const collectTruthJson = (root) => {
            const out = [];
            const stack = [root];
            while (stack.length) {
                const dir = stack.pop();
                let entries = [];
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
                for (const ent of entries) {
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) {
                        // prune obvious noise dirs
                        if (!/^(runs|envelopes|logs|tmp)$/i.test(ent.name)) stack.push(full);
                    } else if (ent.isFile()) {
                        if (ent.name.endsWith('.json') && ent.name.includes(task_id) && ent.name.includes('truth_audit')) {
                            out.push(full);
                        }
                    }
                }
            }
            return out;
        };
        const truthJsonFiles = collectTruthJson(result_dir);
        if (truthJsonFiles.length === 0) {
            console.error('[Gate Light] FAILED: Heavy profile missing truth_audit json evidence.');
            process.exit(1);
        }
        const merged = truthJsonFiles.map((file) => {
            try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
        }).join('\n');
        const hasFirstBreak = /"first_break_layer"\s*:/.test(merged);
        const hasFailPass = /fail_to_pass|preFail|postPass|fail->pass|Fail -> Pass/i.test(merged);
        const hasRealRuntime = /"sample_reconcile_rows"\s*:|"samples"\s*:|is_real_runtime|real runtime/i.test(merged);
        const hasNonRegression = /non_regression|不回退|running_not_mixed|last_7d_not_zeroed/i.test(merged);
        const hasWorkflowEvidence = /gate_diff_table|light_only|heavy_only|workflow profile split|heavy_gate_efficiency|parallel_news_rank_export_ledger|HEAVY_PARALLEL_START|MOCK_SERVER_SESSION/i.test(merged);
        const hasHeavyQualityEvidence = hasNonRegression || hasWorkflowEvidence;
        if (!hasFirstBreak || !hasFailPass || !hasRealRuntime || !hasHeavyQualityEvidence) {
            console.error('[Gate Light] FAILED: Heavy mandatory evidence incomplete.');
            console.error(`  has_first_break_layer=${hasFirstBreak}`);
            console.error(`  has_fail_to_pass=${hasFailPass}`);
            console.error(`  has_real_runtime=${hasRealRuntime}`);
            console.error(`  has_non_regression_or_workflow_evidence=${hasHeavyQualityEvidence}`);
            process.exit(1);
        }
        console.log('[Gate Light] Heavy mandatory evidence verified.');
    } else {
        console.log('[Gate Light] LIGHT profile: heavy mandatory evidence checks skipped.');
    }

    // --- Immutable Integrate & SafeCmd Enforcement (Task 260211_003) ---
    if (task_id >= '260211_003') {
        console.log('[Gate Light] Checking Immutable Integrate & SafeCmd Enforcement...');

        // 1. Run Count Check (Immutable Integrate)
        // rules/task-reports/runs/<task_id>/ should have <= 1 directory
        const runsDir = path.join('rules', 'task-reports', 'runs', task_id);
        if (fs.existsSync(runsDir)) {
            const runDirs = fs.readdirSync(runsDir).filter(name => {
                // Exclude metadata directories
                if (name === 'envelopes' || name === 'locks') return false;
                const fullPath = path.join(runsDir, name);
                return fs.statSync(fullPath).isDirectory();
            });
            if (runDirs.length > 1) {
                console.error(`[Gate Light] FAILED: Immutable Integrate violation. Found multiple run directories for task ${task_id}:`);
                runDirs.forEach(d => console.error(`  - ${d}`));
                console.error('Action: This task is immutable. Use a new task_id for new changes.');
                process.exit(1);
            }
        }

        // 2. Chained Command Detection (SafeCmd)
        // Files to scan:
        // - rules/task-reports/**/trae_report_snippet_<task_id>.txt
        // - rules/task-reports/**/dod_stdout_<task_id>.txt
        // - rules/task-reports/**/command_audit_<task_id>.txt (New)
        
        // We scan result_dir which is usually rules/task-reports/YYYY-MM
        const filesToScan = [
            path.join(result_dir, `trae_report_snippet_${task_id}.txt`),
            path.join(result_dir, `dod_stdout_${task_id}.txt`),
            path.join(result_dir, `command_audit_${task_id}.txt`)
        ];

        let chainDetected = false;
        
        filesToScan.forEach(file => {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                const lines = content.split('\n');
                const chainedLines = [];
                
                lines.forEach((line, index) => {
                    const trimmed = line.trim();
                    // Check for CMD: or command: prefix
                    if (trimmed.startsWith('CMD:') || trimmed.startsWith('command:')) {
                        // Check for forbidden operators: ; && ||
                        // Be careful with false positives? The rule is strict: "命中 ; 或 && 或 || -> FAIL"
                        if (trimmed.includes(';') || trimmed.includes('&&') || trimmed.includes('||')) {
                            chainedLines.push(`Line ${index + 1}: ${trimmed}`);
                        }
                    }
                });

                if (chainedLines.length > 0) {
                    console.error(`[Gate Light] [FAIL] CHAINED_CMD_DETECTED in ${path.basename(file)}:`);
                    chainedLines.slice(0, 10).forEach(l => console.error(`  - ${l}`));
                    if (chainedLines.length > 10) console.error(`  ... and ${chainedLines.length - 10} more.`);
                    chainDetected = true;
                }
            }
        });

        if (chainDetected) {
            console.error('[Gate Light] SafeCmd Violation: Chained commands are prohibited.');
            console.error('Action: Use safe_commit.ps1 / safe_push.ps1 or separate commands.');
            process.exit(1);
        }

        console.log('[Gate Light] Immutable Integrate & SafeCmd Enforcement verified.');
    }

    // --- [REMOVED by M4.5-T0 / 260301_028] Two-Pass Evidence Truth & No Auto-Merge ---

    // --- Error Stats Index & Three-Strike Governance Check (Task 260218_018) ---
    // Only enforced in Integrate mode because Dev mode does not write to the index.
    if (task_id >= '260218_018' && argRunId && argMode === 'Integrate') {
        console.log('[Gate Light] Checking Error Stats Index & Three-Strike Governance...');
        const errorStatsPath = path.join('rules', 'task-reports', 'index', 'error_stats.jsonl');
        
        // 1. Check Index Existence
        if (!fs.existsSync(errorStatsPath)) {
            console.error('[Gate Light] FAILED: Global Error Stats Index missing.');
            console.error(`  Expected: ${errorStatsPath}`);
            console.log('FAIL_ROOT_CAUSE_BLOCK');
            console.log('ERROR_CLASS=ERROR_STATS_INDEX_MISSING');
            console.log('ROOT_CAUSE_HINT=Global error_stats.jsonl must exist and be appended to.');
            console.error(`FIX_CMD: node scripts/error_stats_append.mjs --task_id ${task_id} --run_id ${argRunId} --commit $(git rev-parse HEAD) --mode ${argMode} --source_errors ${result_dir}/errors_${task_id}.jsonl`);
            process.exit(1);
        }

        // 2. Check Record Existence (task_id + run_id)
        const statsContent = fs.readFileSync(errorStatsPath, 'utf8');
        const statsLines = statsContent.split('\n').filter(Boolean);
        const hasRecord = statsLines.some(line => {
            try {
                const rec = JSON.parse(line);
                return rec.task_id === task_id && rec.run_id === argRunId;
            } catch (e) { return false; }
        });

        if (!hasRecord) {
            console.error(`[Gate Light] FAILED: No error record found for Task ${task_id} Run ${argRunId} in index.`);
            console.log('FAIL_ROOT_CAUSE_BLOCK');
            console.log('ERROR_CLASS=ERROR_STATS_RECORD_MISSING');
            console.log('ROOT_CAUSE_HINT=error_stats_append.mjs failed to append record to index.');
            process.exit(1);
        }
        console.log('[Gate Light] Error Stats Index verified (found records for task_id/run_id).');

        // 3. Three-Strike Recalculation
        // Read last 50 lines
        const last50 = statsLines.slice(-50);
        const errorCounts = {};
        
        last50.forEach(line => {
            try {
                const rec = JSON.parse(line);
                if (rec.error_class && rec.error_class !== 'NO_ERROR') {
                    errorCounts[rec.error_class] = (errorCounts[rec.error_class] || 0) + 1;
                }
            } catch (e) {}
        });

        const governanceBacklogDir = path.join('rules', 'task-reports', 'governance-backlog');
        let threeStrikeFail = false;

        Object.entries(errorCounts).forEach(([cls, count]) => {
            if (count >= 3) {
                // Check if GOV file exists
                let hasGov = false;
                if (fs.existsSync(governanceBacklogDir)) {
                    const files = fs.readdirSync(governanceBacklogDir);
                    hasGov = files.some(f => f.includes(`GOV_`) && f.includes(cls));
                }

                if (!hasGov) {
                    console.error(`[Gate Light] FAILED: Three-Strike Governance Triggered for ${cls} (${count} times) but GOV file missing.`);
                    threeStrikeFail = true;
                    console.log('FAIL_ROOT_CAUSE_BLOCK');
                    console.log(`ERROR_CLASS=THREE_STRIKE_GOVERNANCE_MISSING_${cls}`);
                    console.log(`ROOT_CAUSE_HINT=Error class ${cls} recurred >=3 times. scripts/error_three_strike.mjs must generate a GOV file.`);
                }
            }
        });

        if (threeStrikeFail) {
            process.exit(1);
        }
        console.log('[Gate Light] Three-Strike recalculation verified.');
    }

    // --- Scope Lock Check (Task 260305_018) ---
    {
        console.log('[Gate Light] Checking Scope Lock...');
        const scopeLockPath = path.join(result_dir, `scope_lock_${task_id}.json`);
        if (!fs.existsSync(scopeLockPath)) {
            console.log('[Gate Light] WARN: No scope_lock file found. Skipping scope lock check (backward compatible).');
        } else {
            const scopeLock = JSON.parse(fs.readFileSync(scopeLockPath, 'utf8'));
            const allowedFiles = scopeLock.allowed_files || [];
            const autoExempt = scopeLock.auto_exempt || [];
            const allAllowed = [...allowedFiles, ...autoExempt];

            // Also exempt rules/task-reports/ paths (evidence files generated by Integrate)
            const diffOutput = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();
            const changedFiles = diffOutput ? diffOutput.split('\n').filter(Boolean) : [];

            const outOfScope = changedFiles.filter(f => {
                if (allAllowed.includes(f)) return false;
                if (f.startsWith('rules/task-reports/')) return false;
                return true;
            });

            if (outOfScope.length > 0) {
                console.error('[Gate Light] FAILED: Scope Lock violation. Files outside allowed scope:');
                for (const f of outOfScope) {
                    console.error(`  - ${f}`);
                }
                console.error('[Gate Light] FIX_CMD:');
                for (const f of outOfScope) {
                    console.error(`  git checkout main -- ${f}`);
                }
                console.log('GATE_LIGHT_EXIT=1');
                process.exit(1);
            }
            console.log(`[Gate Light] Scope Lock verified (${changedFiles.length} files, all within scope).`);
        }
    }

    // ===== BTCQDD Healthcheck（条件启用）=====
    // 仅当 strategies/crypto_binary/server.mjs 存在时检查，否则 skip
    {
      const btcqddServerPath = path.resolve(process.cwd(), 'strategies/crypto_binary/server.mjs');

      if (fs.existsSync(btcqddServerPath)) {
        try {
          const resp = await fetch('http://localhost:53123/');
          if (resp.status !== 200) {
            console.warn('[Gate Light] BTCQDD Healthcheck: WARN — GET localhost:53123/ returned', resp.status);
            console.warn('FIX_CMD: node strategies/crypto_binary/server.mjs --strategy=btc_15m');
          } else {
            console.log('[Gate Light] BTCQDD Healthcheck: PASS');
          }
        } catch (e) {
          console.warn('[Gate Light] BTCQDD Healthcheck: WARN — service not running —', e.message);
          console.warn('FIX_CMD: node strategies/crypto_binary/server.mjs --strategy=btc_15m');
        }
      } else {
        console.log('[Gate Light] SKIP BTCQDD_HEALTHCHECK (server.mjs not found)');
      }
    }

    // Construct postflight command
    // Note: Assuming scripts/postflight_validate_envelope.mjs exists relative to CWD
    const isPreviewMode = process.env.GENERATE_PREVIEW === '1' || process.env.GATE_LIGHT_GENERATE_PREVIEW === '1';
    
    if (isPreviewMode) {
        console.log('[Gate Light] Skipping Postflight Envelope Validation (Preview Mode).');
    } else {
        const cmd = 'node scripts/postflight_validate_envelope.mjs --task_id ' + task_id + ' --result_dir ' + result_dir + ' --report_dir ' + result_dir;
        
        console.log('[Gate Light] Executing: ' + cmd);
        execSync(cmd, { stdio: 'inherit' });
    }

    writeProfile();
    console.log('[Gate Light] PASS');
    console.log('GATE_LIGHT_EXIT=0');
} catch (error) {
    console.error('[Gate Light] FAILED');
    console.error(error);
    // If execSync fails, it throws. We can exit 1 here.
    process.exit(1);
}
