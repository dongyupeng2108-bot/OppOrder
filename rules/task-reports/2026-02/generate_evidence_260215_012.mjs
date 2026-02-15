import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const TASK_ID = '260215_012';
const EVIDENCE_DIR = path.join('rules', 'task-reports', '2026-02');
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, `rank_v2_contract_guard_${TASK_ID}.txt`);
const DOD_FILE = path.join(EVIDENCE_DIR, `dod_evidence_${TASK_ID}.txt`);
const GIT_META_FILE = path.join(EVIDENCE_DIR, `git_meta_${TASK_ID}.json`);
const RESULT_FILE = path.join(EVIDENCE_DIR, `result_${TASK_ID}.json`);

// Ensure evidence directory exists
if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function getSha256Short(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
}

function runGit(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8' }).trim();
    } catch (e) {
        return null;
    }
}

function run() {
    console.log(`[Evidence] Generating Evidence for Task ${TASK_ID}...`);

    // --- 1. CI Parity Probe ---
    console.log('[Evidence] Running CI Parity Probe...');
    try {
        // Use node to run the script, assuming CWD is repo root
        execSync(`node scripts/ci_parity_probe.mjs --task_id ${TASK_ID} --result_dir ${EVIDENCE_DIR}`, { stdio: 'inherit' });
    } catch (e) {
        console.error('[Evidence] Failed to run CI Parity Probe.');
        process.exit(1);
    }

    // --- 2. Git Meta ---
    console.log('[Evidence] Generating Git Meta...');
    const branch = runGit('git branch --show-current') || 'unknown';
    const commit = runGit('git rev-parse HEAD') || 'unknown';
    const gitMeta = {
        branch,
        commit,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(GIT_META_FILE, JSON.stringify(gitMeta, null, 2));

    // --- 3. Result JSON Skeleton ---
    console.log('[Evidence] Generating Result JSON Skeleton...');
    const resultJson = {
        task_id: TASK_ID,
        status: 'IN_PROGRESS', // assemble_evidence will update to DONE
        summary: 'Rank V2 Contract Version Guard Implementation',
        dod_evidence: {
            rank_v2_guard: true // Marker
        }
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(resultJson, null, 2));

    // --- 4. Rank V2 Contract Version Guard (The Core Logic) ---
    console.log('[Evidence] Running Rank V2 Contract Version Guard Check...');
    
    const contractPath = 'OppRadar/contracts/rank_v2.contract.json';
    const schemaPath = 'OppRadar/contracts/opps_rank_v2_response.schema.json';
    
    // 1. Get Base Commit
    let baseCommit;
    try {
        try {
            execSync('git rev-parse origin/main', { stdio: 'ignore' });
        } catch (e) {
            execSync('git fetch origin main', { stdio: 'ignore' });
        }
        baseCommit = execSync('git merge-base origin/main HEAD').toString().trim();
    } catch (e) {
        console.warn(`[Evidence] Warning: Could not determine merge-base. Defaulting to origin/main.`);
        baseCommit = 'origin/main';
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

    // Logic Check
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

    // Write Detailed Evidence File
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
    console.log(`[Evidence] Wrote detailed evidence to ${EVIDENCE_FILE}`);

    // Write DoD Evidence File (for assemble_evidence)
    const dodContent = [
        summaryLine,
        `See detailed evidence: ${path.basename(EVIDENCE_FILE)}`
    ].join('\n');
    
    fs.writeFileSync(DOD_FILE, dodContent);
    console.log(`[Evidence] Wrote DoD evidence to ${DOD_FILE}`);
}

run();
