import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const TASK_ID = '260215_012';
const EVIDENCE_DIR = path.join('rules', 'task-reports', '2026-02');
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, `rank_v2_contract_guard_${TASK_ID}.txt`);
const NOTIFY_FILE = path.join(EVIDENCE_DIR, `notify_${TASK_ID}.txt`);

// Ensure evidence directory exists
if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function getSha256Short(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
}

function run() {
    console.log(`[Evidence] Generating Rank V2 Contract Version Guard Evidence for Task ${TASK_ID}...`);

    const contractPath = 'OppRadar/contracts/rank_v2.contract.json';
    const schemaPath = 'OppRadar/contracts/rank_v2_response.schema.json';

    // 1. Get Base Commit
    let baseCommit;
    try {
        // Try to get merge-base with origin/main
        // Ensure origin/main is fetched (run_task.ps1 usually does this, but good to be safe)
        try {
            execSync('git rev-parse origin/main', { stdio: 'ignore' });
        } catch (e) {
            execSync('git fetch origin main', { stdio: 'ignore' });
        }
        baseCommit = execSync('git merge-base origin/main HEAD').toString().trim();
    } catch (e) {
        console.warn(`[Evidence] Warning: Could not determine merge-base. Defaulting to origin/main or HEAD^ if fallback needed. Error: ${e.message}`);
        // Fallback for local dev without origin/main? 
        // If we can't find base, we can't strictly prove the guard, but we can output current state.
        // For now, assume origin/main exists as per workflow.
        process.exit(1);
    }

    console.log(`[Evidence] Base Commit: ${baseCommit}`);
    console.log(`[Evidence] Head Commit: HEAD`);

    // 2. Read Files
    const getFileContent = (commit, filePath) => {
        try {
            if (commit === 'HEAD') {
                return fs.readFileSync(filePath, 'utf8');
            }
            return execSync(`git show ${commit}:${filePath}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
        } catch (e) {
            return null; // File didn't exist
        }
    };

    const headContractStr = getFileContent('HEAD', contractPath);
    const headSchemaStr = getFileContent('HEAD', schemaPath);
    const baseContractStr = getFileContent(baseCommit, contractPath);
    const baseSchemaStr = getFileContent(baseCommit, schemaPath);

    if (!headContractStr || !headSchemaStr) {
        console.error('[Evidence] FAILED: Contract or Schema missing in HEAD.');
        process.exit(1);
    }

    const headContract = JSON.parse(headContractStr);
    const baseContract = baseContractStr ? JSON.parse(baseContractStr) : null;
    
    const headSchemaHash = getSha256Short(headSchemaStr);
    const baseSchemaHash = baseSchemaStr ? getSha256Short(baseSchemaStr) : '00000000';

    const schemaChanged = headSchemaHash !== baseSchemaHash;
    const baseVersion = baseContract ? baseContract.contract_version : '0.0';
    const headVersion = headContract.contract_version;

    console.log(`[Evidence] Schema Changed: ${schemaChanged} (${baseSchemaHash} -> ${headSchemaHash})`);
    console.log(`[Evidence] Version: ${baseVersion} -> ${headVersion}`);

    // Logic Check (Duplicate of Gate Light, but for Evidence Record)
    let ok = true;
    let failureReason = '';

    // Check 1: Schema Hash Match
    if (headContract.schema_sha256_short !== headSchemaHash) {
        ok = false;
        failureReason += `Hash Mismatch (Contract: ${headContract.schema_sha256_short}, Actual: ${headSchemaHash}); `;
    }

    // Check 2: Version Increment if Schema Changed
    if (schemaChanged) {
        if (parseFloat(headVersion) <= parseFloat(baseVersion)) {
             ok = false;
             failureReason += `Version did not increment on schema change (${baseVersion} -> ${headVersion}); `;
        }
    }

    const status = ok ? 'ok=true' : `ok=false reason="${failureReason.trim()}"`;
    
    // Output Line
    const summaryLine = `DOD_EVIDENCE_RANK_V2_CONTRACT_VERSION_GUARD: ${contractPath} => ${status} base_version=${baseVersion} head_version=${headVersion} schema_changed=${schemaChanged}`;
    
    console.log(`[Evidence] ${summaryLine}`);

    // Write Evidence File
    const fileContent = [
        `=== Rank V2 Contract Version Guard Evidence ===`,
        `Task: ${TASK_ID}`,
        `Date: ${new Date().toISOString()}`,
        `Base Commit: ${baseCommit}`,
        `Head Commit: HEAD`,
        ``,
        `--- Comparison ---`,
        `Schema Path: ${schemaPath}`,
        `Contract Path: ${contractPath}`,
        `Base Schema Hash: ${baseSchemaHash}`,
        `Head Schema Hash: ${headSchemaHash}`,
        `Schema Changed: ${schemaChanged}`,
        `Base Version: ${baseVersion}`,
        `Head Version: ${headVersion}`,
        ``,
        `--- Verification ---`,
        `Status: ${ok ? 'PASS' : 'FAIL'}`,
        `Reason: ${failureReason || 'None'}`,
        ``,
        `--- Summary Line ---`,
        summaryLine
    ].join('\n');

    fs.writeFileSync(EVIDENCE_FILE, fileContent);
    console.log(`[Evidence] Wrote to ${EVIDENCE_FILE}`);

    // Append to Notify (Simulated here, but usually assemble_evidence does this or we output to stdout)
    // The user requirement says: "DoD Evidence ... must add a line ... and put corresponding evidence file..."
    // Usually run_task.ps1 captures stdout to DOD_EVIDENCE_STDOUT.
    // So printing the summaryLine to stdout is important.
}

run();
