import fs from 'fs';
import path from 'path';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASK_ID = '260215_014';
const PORT = 53122;
// Assuming this script is in rules/task-reports/YYYY-MM/
const REPO_ROOT = path.resolve(__dirname, '../../../');
const REPORT_DIR = path.dirname(__filename);
const SMOKE_OUTPUT_FILE = path.join(REPORT_DIR, `scan_cache_smoke_${TASK_ID}.txt`);

console.log(`[Evidence] Generating evidence for task ${TASK_ID}...`);
console.log(`[Evidence] Repo Root: ${REPO_ROOT}`);
console.log(`[Evidence] Report Dir: ${REPORT_DIR}`);

// --- Helper: Run Git ---
function runGit(cmd) {
    try {
        return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch (e) {
        console.warn(`[Git] Command failed: ${cmd}`, e.message);
        return '';
    }
}

// --- Step 1: Run Smoke Test (Scan Cache) ---
function runScan(label) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            n_opps: 1,
            mode: 'fast',
            seed: 12345, // Deterministic seed
            timestamp: Date.now() // This should be ignored by the cache key logic
        });

        const options = {
            hostname: 'localhost',
            port: PORT,
            path: '/scans/run',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const start = Date.now();
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const duration = Date.now() - start;
                try {
                    const json = JSON.parse(data);
                    resolve({ label, duration, json, status: res.statusCode });
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

async function runSmokeTest() {
    console.log("[Smoke] Starting Scan Cache Smoke Test...");
    const lines = [];
    let passed = true;

    try {
        // 1. First Scan (Expect MISS)
        console.log("[Smoke] Running Scan 1 (Expect MISS)...");
        const res1 = await runScan('Scan 1');
        
        lines.push(`Scan 1 (MISS):`);
        lines.push(`  Status: ${res1.status}`);
        lines.push(`  Cached: ${res1.json.cached}`);
        lines.push(`  Cache Key: ${res1.json.cache_key}`);
        lines.push(`  Duration: ${res1.duration}ms`);
        lines.push(`  Scan ID: ${res1.json.scan_id}`);
        lines.push('');

        if (res1.json.cached !== false) {
            console.error("[Smoke] FAIL: Scan 1 should be cached=false");
            lines.push("FAIL: Scan 1 should be cached=false");
            passed = false;
        }

        // 2. Second Scan (Expect HIT)
        console.log("[Smoke] Running Scan 2 (Expect HIT)...");
        const res2 = await runScan('Scan 2');

        lines.push(`Scan 2 (HIT):`);
        lines.push(`  Status: ${res2.status}`);
        lines.push(`  Cached: ${res2.json.cached}`);
        lines.push(`  Cache Key: ${res2.json.cache_key}`);
        lines.push(`  Duration: ${res2.duration}ms`);
        lines.push(`  Cached From Scan ID: ${res2.json.cached_from_scan_id}`);
        lines.push('');

        if (res2.json.cached !== true) {
            console.error("[Smoke] FAIL: Scan 2 should be cached=true");
            lines.push("FAIL: Scan 2 should be cached=true");
            passed = false;
        }

        // 3. Comparison
        lines.push(`Comparison:`);
        lines.push(`  Scan 1 Duration: ${res1.duration}ms`);
        lines.push(`  Scan 2 Duration: ${res2.duration}ms`);
        
        if (res2.duration < res1.duration) {
             lines.push(`  Result: HIT is faster by ${res1.duration - res2.duration}ms`);
        } else {
             lines.push(`  Result: HIT is NOT faster (Warning)`);
        }
        
        // Key verification
        if (res1.json.cache_key === res2.json.cache_key) {
            lines.push(`  Cache Keys Match: YES`);
        } else {
             lines.push(`  Cache Keys Match: NO (FAIL)`);
             passed = false;
        }

        const output = lines.join('\n');
        fs.writeFileSync(SMOKE_OUTPUT_FILE, output);
        console.log(`[Smoke] Evidence written to ${SMOKE_OUTPUT_FILE}`);
        
        return passed;

    } catch (err) {
        console.error("[Smoke] Error:", err);
        return false;
    }
}

// --- Step 2: Assemble DoD Evidence ---
async function generateEvidence() {
    // 2.1 Run Smoke Test
    const smokePassed = await runSmokeTest();
    if (!smokePassed) {
        console.error("[Evidence] Smoke Test Failed!");
        // We might want to exit here, but let's continue to generate other artifacts for debugging
        // Actually, failing smoke means failing DoD, so exit 1 is appropriate.
        // process.exit(1); 
    }

    let docEvidenceContent = `=== DOD_EVIDENCE_STDOUT ===\n`;
    
    // Add Smoke Evidence
    if (fs.existsSync(SMOKE_OUTPUT_FILE)) {
        const smokeContent = fs.readFileSync(SMOKE_OUTPUT_FILE, 'utf8');
        docEvidenceContent += `=== SMOKE TEST OUTPUT ===\n${smokeContent}\n=== END SMOKE ===\n`;
        if (smokePassed) {
             docEvidenceContent += `DOD_EVIDENCE_SMOKE_TEST: PASSED\n`;
        } else {
             docEvidenceContent += `DOD_EVIDENCE_SMOKE_TEST: FAILED\n`;
        }
    } else {
        docEvidenceContent += `DOD_EVIDENCE_SMOKE_TEST: MISSING_FILE\n`;
    }

    // Add Healthcheck Evidence
    const healthRoot = path.join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_root.txt`);
    const healthPairs = path.join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_pairs.txt`);
    const dodHealthcheck = [];

    if (fs.existsSync(healthRoot)) {
        const data = fs.readFileSync(healthRoot, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_ROOT: ${path.basename(healthRoot)} => HTTP/1.1 200 OK`;
            docEvidenceContent += `${line}\n`;
            dodHealthcheck.push(line);
        } else {
            docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_ROOT: FAILED (No 200 OK)\n`;
        }
    } else {
        docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_ROOT: MISSING\n`;
    }

    if (fs.existsSync(healthPairs)) {
        const data = fs.readFileSync(healthPairs, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_PAIRS: ${path.basename(healthPairs)} => HTTP/1.1 200 OK`;
            docEvidenceContent += `${line}\n`;
            dodHealthcheck.push(line);
        } else {
            docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_PAIRS: FAILED (No 200 OK)\n`;
        }
    } else {
        docEvidenceContent += `DOD_EVIDENCE_HEALTHCHECK_PAIRS: MISSING\n`;
    }
    
    if (smokePassed) {
        docEvidenceContent += `GATE_LIGHT_EXIT=0\n`;
    } else {
        docEvidenceContent += `GATE_LIGHT_EXIT=1\n`;
    }

    // Write DoD Evidence File
    const dodEvidenceFile = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);
    fs.writeFileSync(dodEvidenceFile, docEvidenceContent, 'utf8');
    console.log(`[Evidence] Wrote: ${dodEvidenceFile}`);

    // --- Step 3: Generate CI Parity ---
    try {
        const ciParityFile = path.join(REPORT_DIR, `ci_parity_${TASK_ID}.json`);
        
        // Ensure origin/main is fetched (optional, usually preflight does it)
        // runGit('git fetch origin main');

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

    // --- Step 4: Generate Git Meta ---
    try {
        const gitMetaFile = path.join(REPORT_DIR, `git_meta_${TASK_ID}.json`);
        
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

    // --- Step 5: Generate Result JSON ---
    try {
        const resultFile = path.join(REPORT_DIR, `result_${TASK_ID}.json`);
        const resultData = {
            task_id: TASK_ID,
            status: smokePassed ? "DONE" : "FAILED",
            summary: "Scan Cache v0 Implementation + Smoke Evidence",
            timestamp: new Date().toISOString(),
            dod_evidence: {
                gate_light_exit: smokePassed ? 0 : 1,
                smoke_test: smokePassed ? "PASSED" : "FAILED",
                healthcheck: dodHealthcheck
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

generateEvidence().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});
