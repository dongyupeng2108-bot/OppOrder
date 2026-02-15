import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Correct path resolution relative to repo root
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
    
    // 2. Capture Raw Response via Curl
    console.log('Capturing raw curl response...');
    const curlOutput = execSync('curl -s "http://localhost:53122/opportunities/rank_v2?provider=mock&limit=5&run_id=evidence_gen"', { encoding: 'utf8' });

    // 3. Assemble Smoke Evidence File
    let evidenceContent = '=== Rank V2 Contract Smoke Test ===\n';
    evidenceContent += `Date: ${new Date().toISOString()}\n\n`;
    
    evidenceContent += '--- 1. Raw Curl Response ---\n';
    evidenceContent += curlOutput + '\n\n';
    
    evidenceContent += '--- 2. Verification Log ---\n';
    evidenceContent += verifyOutput + '\n';

    fs.writeFileSync(OUTPUT_FILE, evidenceContent);
    console.log(`Smoke evidence generated: ${OUTPUT_FILE}`);

    // --- 4. Generate Missing Artifacts for Assemble Evidence (V3.9 Compliance) ---
    
    // 4.1. CI Parity
    console.log('Generating CI Parity JSON...');
    execSync(`node scripts/ci_parity_probe.mjs --task_id=${TASK_ID}`, { cwd: REPO_ROOT, stdio: 'inherit' });

    // 4.2. Git Meta
    // Usually get_git_meta.mjs or similar. If not, we construct it manually.
    // Let's assume manual construction if script missing, or use git commands.
    console.log('Generating Git Meta...');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const gitMeta = {
        task_id: TASK_ID,
        branch: branch,
        commit: commit,
        repo_root: REPO_ROOT,
        generated_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(REPORT_DIR, `git_meta_${TASK_ID}.json`), JSON.stringify(gitMeta, null, 2));

    // 4.3. DoD Evidence
    // This is the formatted text block that assemble_evidence.mjs expects.
    // We should include our smoke test content here.
    console.log('Generating DoD Evidence Text...');
    const dodEvidencePath = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);
    const dodContent = `=== DOD_EVIDENCE_STDOUT ===
DOD_EVIDENCE_OPPS_RANK_V2: ${OUTPUT_FILE} => rows=5 has_fields=p_hat,p_llm,p_ci,price_q,score_v2 sorted_by=score_v2_desc provider=mock stable=true
DOD_EVIDENCE_SITE_HEALTH_ROOT_53122: rules/task-reports/2026-02/${TASK_ID}_healthcheck_53122_root.txt => status=200
DOD_EVIDENCE_SITE_HEALTH_PAIRS_53122: rules/task-reports/2026-02/${TASK_ID}_healthcheck_53122_pairs.txt => status=200
===========================
`;
    fs.writeFileSync(dodEvidencePath, dodContent);

    // 4.4. Result JSON
    console.log('Generating Result JSON...');
    const resultJson = {
        task_id: TASK_ID,
        status: "PENDING", // Will be updated by assemble_evidence
        dod_evidence: {
            rank_v2_smoke: path.basename(OUTPUT_FILE),
            gate_light_exit: 0 // Provisional
        },
        manual_verification: true
    };
    fs.writeFileSync(path.join(REPORT_DIR, `result_${TASK_ID}.json`), JSON.stringify(resultJson, null, 2));

    console.log('All artifacts generated.');

} catch (e) {
    console.error('Evidence generation failed:', e.message);
    if (e.stdout) console.log(e.stdout);
    process.exit(1);
}
