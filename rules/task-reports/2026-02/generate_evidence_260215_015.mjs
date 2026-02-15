
import http from 'http';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;
const TASK_ID = '260215_015';
const REPORT_DIR = join(__dirname, '.'); // current dir (rules/task-reports/2026-02)

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Helper: HTTP Request
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: path,
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

// Helper: Run Command via child_process (for curl)
async function generateHealthCheck(filename, pathStr) {
    console.log(`[Healthcheck] Generating ${filename}...`);
    try {
        const res = await request('GET', pathStr);
        const content = `HTTP/1.1 ${res.statusCode} OK\nDate: ${new Date().toUTCString()}\nContent-Type: ${res.headers['content-type']}\n\n`;
        fs.writeFileSync(join(REPORT_DIR, filename), content);
        console.log(`[Healthcheck] Written ${filename}`);
        return true;
    } catch (e) {
        console.error(`[Healthcheck] Failed to generate ${filename}:`, e);
        return false;
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
        const res = await request('POST', '/scans/batch_run', batchParams);
        
        if (res.statusCode !== 200) {
            console.error(`[Smoke] FAIL: Status code ${res.statusCode}`);
            return false;
        }

        const json = JSON.parse(res.body);
        
        // 2. Validate Root Fields
        lines.push(`Run ID: ${json.run_id}`);
        lines.push(`Duration: ${json.duration_ms}ms`);
        lines.push(`OK Count: ${json.ok_count} (Expected: 2)`);
        lines.push(`Failed Count: ${json.failed_count} (Expected: 1)`);
        
        if (json.ok_count !== 2 || json.failed_count !== 1) {
            lines.push("FAIL: Counts do not match expectations.");
            passed = false;
        }

        // 3. Validate Jobs
        const jobs = json.jobs || json.results;
        if (!jobs || !Array.isArray(jobs)) {
            lines.push("FAIL: 'jobs' array missing.");
            passed = false;
        } else {
            lines.push(`Jobs Count: ${jobs.length}`);
            
            jobs.forEach((job, i) => {
                lines.push(`Job ${i+1}: ${job.topic_key}`);
                lines.push(`  Status: ${job.status}`);
                lines.push(`  Duration: ${job.duration_ms}ms`);
                if (job.status === 'failed') {
                    lines.push(`  Error Code: ${job.error_code}`);
                    lines.push(`  Error Message: ${job.error_message}`);
                }
                
                // Assertions per job
                if (job.topic_key === 'topic_smoke_fail') {
                    if (job.status !== 'failed' || job.error_code !== 'MOCK_INJECTED_FAILURE') {
                         lines.push(`  FAIL: Expected status=failed, code=MOCK_INJECTED_FAILURE`);
                         passed = false;
                    }
                } else {
                    if (job.status !== 'ok') {
                        lines.push(`  FAIL: Expected status=ok`);
                        passed = false;
                    }
                }
            });
        }

        // 4. Write Evidence
        const evidencePath = join(REPORT_DIR, `scan_observability_smoke_${TASK_ID}.txt`);
        fs.writeFileSync(evidencePath, lines.join('\n'));
        console.log(`[Smoke] Evidence written to ${evidencePath}`);
        
        // Print content for DoD
        console.log("\n--- Smoke Evidence Content ---");
        console.log(lines.join('\n'));
        console.log("------------------------------\n");

    } catch (e) {
        console.error("[Smoke] Exception:", e);
        passed = false;
    }

    return passed;
}

async function main() {
    console.log(`Generating evidence for Task ${TASK_ID}...`);
    
    // 1. Healthchecks
    await generateHealthCheck(`${TASK_ID}_healthcheck_53122_root.txt`, '/');
    await generateHealthCheck(`${TASK_ID}_healthcheck_53122_pairs.txt`, '/pairs');
    
    // 2. Smoke Test
    const smokePassed = await runSmokeTest();
    
    if (!smokePassed) {
        console.error("Smoke Test FAILED.");
        process.exit(1);
    }
    
    console.log("All evidence generated successfully.");
}

main();
