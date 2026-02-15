import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Correct path resolution relative to repo root
// script is in rules/task-reports/2026-02/
// repo root is ../../../
const REPO_ROOT = path.resolve(__dirname, '../../../');
const TASK_ID = '260215_011';
const REPORT_DIR = path.join(REPO_ROOT, 'rules', 'task-reports', '2026-02');
const OUTPUT_FILE = path.join(REPORT_DIR, `rank_v2_contract_smoke_${TASK_ID}.txt`);

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

console.log(`Generating evidence for ${TASK_ID}...`);

try {
    // 1. Run verify script (Contract Check + Hash)
    console.log('Running verify_rank_v2_contract.mjs...');
    const verifyScriptPath = path.join(REPO_ROOT, 'scripts', 'verify_rank_v2_contract.mjs');
    const verifyOutput = execSync(`node "${verifyScriptPath}"`, { encoding: 'utf8', cwd: REPO_ROOT });
    
    // 2. Capture Raw Response via Curl (as per requirement)
    // Note: mock_server_53122 must be running. verify_rank_v2_contract.mjs starts it if needed, 
    // but we should ensure it's up. The verify script leaves it running? 
    // Actually verify_rank_v2_contract.mjs kills the server if it started it (lines 144-147).
    // So we might need to rely on the server being running (run_task.ps1 checks healthcheck first, so it should be running).
    // However, if verify script kills it, we might have an issue if we run curl after.
    // Let's reverse the order or assume run_task.ps1 keeps it running?
    // run_task.ps1 does healthcheck, then runs generation.
    // verify_rank_v2_contract.mjs tries to connect, if fails, starts its own, then kills it.
    // If run_task.ps1 ensures server is running, verify script will see it running and NOT kill it.
    // Let's assume server is running.
    
    console.log('Capturing raw curl response...');
    // Using simple curl command.
    const curlOutput = execSync('curl -s "http://localhost:53122/opportunities/rank_v2?provider=mock&limit=5&run_id=evidence_gen"', { encoding: 'utf8' });

    // 3. Assemble Evidence File
    let evidenceContent = '=== Rank V2 Contract Smoke Test ===\n';
    evidenceContent += `Date: ${new Date().toISOString()}\n\n`;
    
    evidenceContent += '--- 1. Raw Curl Response ---\n';
    evidenceContent += curlOutput + '\n\n';
    
    evidenceContent += '--- 2. Verification Log ---\n';
    evidenceContent += verifyOutput + '\n';

    fs.writeFileSync(OUTPUT_FILE, evidenceContent);
    console.log(`Evidence generated: ${OUTPUT_FILE}`);

} catch (e) {
    console.error('Evidence generation failed:', e.message);
    if (e.stdout) console.log(e.stdout);
    process.exit(1);
}
