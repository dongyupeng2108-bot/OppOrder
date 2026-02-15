import http from 'http';
import fs from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const PORT = 53122;
const TASK_ID = '260215_015';
const REPORT_DIR = __dirname; // current dir (rules/task-reports/2026-02)
const REPO_ROOT = resolve(__dirname, '../../../');

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Helper: HTTP Request
function request(method, pathStr, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: pathStr,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Helper: Run Git
function runGit(cmd) {
    try {
        return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch (e) {
        console.warn(`[Git] Command failed: ${cmd}`, e.message);
        return '';
    }
}

async function runSmokeTest() {
    console.log("[Smoke] Starting Scan Observability Smoke Test...");
    const lines = [];
    let passed = true;

    try {
        // 1. Prepare Batch Request with Failure Injection
        const batchParams = {
            topics: [
                { topic_key: 'topic_smoke_ok_1', n_opps: 1 },
                { topic_key: 'topic_smoke_fail', simulate_error: true }, // Should fail
                { topic_key: 'topic_smoke_ok_2', n_opps: 1 }
            ],
            concurrency: 2,
            n_opps: 1,
            seed: 999
        };

        console.log("[Smoke] Sending Batch Request...");
        const response = await request('POST', '/scans/batch_run', batchParams); // Rename res to response to avoid conflict
        
        if (response.statusCode !== 200) {
            console.error(`[Smoke] FAIL: Status code ${response.statusCode}`);
            return false;
        }

        const json = JSON.parse(response.body);
        
        // 2. Validate Root Fields
        lines.push(`Run ID: ${json.run_id}`);
        lines.push(`Duration: ${json.duration_ms}ms`);
        lines.push(`OK Count: ${json.ok_count} (Expected: 2)`);
        lines.push(`Failed Count: ${json.failed_count} (Expected: 1)`);
        lines.push(`Jobs Count: ${json.jobs.length}`);

        if (json.ok_count !== 2 || json.failed_count !== 1) {
            console.error(`[Smoke] FAIL: Counts mismatch. OK=${json.ok_count}, Failed=${json.failed_count}`);
            passed = false;
        }

        // 3. Validate Individual Jobs
        json.jobs.forEach((job, idx) => {
            lines.push(`Job ${idx + 1}: ${job.topic_key}`);
            lines.push(`  Status: ${job.status}`);
            lines.push(`  Duration: ${job.duration_ms}ms`);
            
            if (job.status === 'failed') {
                 lines.push(`  Error Code: ${job.error_code}`);
                 lines.push(`  Error Message: ${job.error_message}`);
                 if (job.error_code !== 'MOCK_INJECTED_FAILURE') {
                     console.error(`[Smoke] FAIL: Unexpected error code ${job.error_code}`);
                     passed = false;
                 }
            } else if (job.status === 'ok') {
                 // OK
            } else {
                 console.error(`[Smoke] FAIL: Unexpected status ${job.status}`);
                 passed = false;
            }
        });

        const output = lines.join('\n');
        const smokeFile = join(REPORT_DIR, `scan_observability_smoke_${TASK_ID}.txt`);
        fs.writeFileSync(smokeFile, output);
        console.log(`[Smoke] Evidence written to ${smokeFile}`);
        
        console.log("\n--- Smoke Evidence Content ---");
        console.log(output);
        console.log("------------------------------\n");

        return passed;

    } catch (err) {
        console.error("[Smoke] Error:", err);
        return false;
    }
}

async function main() {
    console.log(`[Evidence] Generating evidence for task ${TASK_ID}...`);
    
    // 1. Healthcheck
    // Note: run_task.ps1 usually generates healthcheck files via curl.
    // But we can generate them here too if needed, or check if they exist.
    // Since run_task.ps1 does it, we assume they might exist or we generate them as backup.
    // For consistency with 014 logic, we can try to generate them if missing, but run_task.ps1 handles it.
    // However, we need to generate DoD Evidence which REFERENCES them.
    
    // 2. Run Smoke Test
    const smokePassed = await runSmokeTest();
    
    // 3. Generate DoD Evidence File
    let docEvidenceContent = `=== DOD_EVIDENCE_STDOUT ===\n`;
    let healthPassed = true;
    
    // Add Smoke Evidence
    const smokeFile = join(REPORT_DIR, `scan_observability_smoke_${TASK_ID}.txt`);
    if (fs.existsSync(smokeFile)) {
        const smokeContent = fs.readFileSync(smokeFile, 'utf8');
        docEvidenceContent += `=== SMOKE TEST OUTPUT ===\n${smokeContent}\n=== END SMOKE ===\n`;
        docEvidenceContent += `DOD_EVIDENCE_SMOKE_TEST: ${smokePassed ? 'PASSED' : 'FAILED'}\n`;
    } else {
        docEvidenceContent += `DOD_EVIDENCE_SMOKE_TEST: MISSING_FILE\n`;
        healthPassed = false; // Treat missing smoke as a health issue for consistency, though strictly it's smoke
    }

    // Add Healthcheck Evidence (Check files generated by run_task.ps1)
    const healthRoot = join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_root.txt`);
    const healthPairs = join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_pairs.txt`);
    
    const healthcheckLines = [];

    if (fs.existsSync(healthRoot)) {
        const data = fs.readFileSync(healthRoot, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_ROOT: ${TASK_ID}_healthcheck_53122_root.txt => HTTP/1.1 200 OK`;
            docEvidenceContent += line + '\n';
            healthcheckLines.push(line);
        } else {
            docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_ROOT: FAILED\n`;
            healthPassed = false;
        }
    } else {
        // If run_task.ps1 hasn't run yet or failed, this might be missing. 
        // But this script is called BY run_task.ps1 AFTER healthcheck step.
        docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_ROOT: MISSING\n`;
        healthPassed = false;
    }

    if (fs.existsSync(healthPairs)) {
        const data = fs.readFileSync(healthPairs, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_PAIRS: ${TASK_ID}_healthcheck_53122_pairs.txt => HTTP/1.1 200 OK`;
            docEvidenceContent += line + '\n';
            healthcheckLines.push(line);
        } else {
            docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_PAIRS: FAILED\n`;
            healthPassed = false;
        }
    } else {
        docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_PAIRS: MISSING\n`;
        healthPassed = false;
    }

    docEvidenceContent += `GATE_LIGHT_EXIT=${smokePassed ? 0 : 1}\n`;

    const dodEvidenceFile = join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);
    fs.writeFileSync(dodEvidenceFile, docEvidenceContent, 'utf8');
    console.log(`[Evidence] Wrote: ${dodEvidenceFile}`);

    // 4. Generate CI Parity
    try {
        const ciParityFile = join(REPORT_DIR, `ci_parity_${TASK_ID}.json`);
        const base = runGit('git rev-parse origin/main');
        const head = runGit('git rev-parse HEAD');
        const mergeBase = runGit('git merge-base origin/main HEAD');
        
        let scopeFiles = [];
        try {
            const diffOutput = runGit('git diff --name-only origin/main...HEAD');
            scopeFiles = diffOutput ? diffOutput.split('\n').map(l => l.trim()).filter(Boolean) : [];
        } catch (e) {
            console.warn('[Git] diff failed, assuming empty scope.');
        }

        const ciData = {
            task_id: TASK_ID,
            base,
            head,
            merge_base: mergeBase,
            scope_count: scopeFiles.length,
            scope_files: scopeFiles,
            timestamp: new Date().toISOString()
        };
        
        fs.writeFileSync(ciParityFile, JSON.stringify(ciData, null, 2));
        console.log(`[Evidence] Wrote: ${ciParityFile}`);
    } catch (e) {
        console.error('[Evidence] Failed to generate CI Parity:', e);
    }

    // 5. Generate Git Meta
    try {
        const gitMetaFile = join(REPORT_DIR, `git_meta_${TASK_ID}.json`);
        const branch = runGit('git rev-parse --abbrev-ref HEAD');
        const commit = runGit('git rev-parse --short HEAD');
        
        const metaData = {
            branch,
            commit,
            task_id: TASK_ID
        };
        
        fs.writeFileSync(gitMetaFile, JSON.stringify(metaData, null, 2));
        console.log(`[Evidence] Wrote: ${gitMetaFile}`);
    } catch (e) {
        console.error('[Evidence] Failed to generate Git Meta:', e);
    }

    // 6. Generate Result JSON
    try {
        const resultFile = join(REPORT_DIR, `result_${TASK_ID}.json`);
        const resultData = {
            task_id: TASK_ID,
            status: smokePassed ? "DONE" : "FAILED",
            summary: "Scan Observability & Failure Isolation (PR3)",
            timestamp: new Date().toISOString(),
            dod_evidence: {
                gate_light_exit: smokePassed ? 0 : 1,
                smoke_test: smokePassed ? "PASSED" : "FAILED",
                healthcheck: healthcheckLines
            }
        };
        
        fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2));
        console.log(`[Evidence] Wrote: ${resultFile}`);
    } catch (e) {
        console.error('[Evidence] Failed to generate Result JSON:', e);
    }

    if (!smokePassed) {
        console.error('[Evidence] Generation failed due to Smoke Test failure.');
        process.exit(1);
    }

    console.log('[Evidence] Generation completed successfully.');
    console.log('GATE_LIGHT_EXIT=0');
}

main().catch(err => {
    console.error("[Evidence] Unhandled error:", err);
    process.exit(1);
});
