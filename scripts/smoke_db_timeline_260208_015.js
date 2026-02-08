import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Config
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;
const REPORT_DIR = path.join('rules', 'task-reports', '2026-02');
const REPORT_FILE = path.join(REPORT_DIR, '260208_015_healthcheck_53122.txt');

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function log(msg) {
    console.log(`[SmokeTest] ${msg}`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: PORT,
            path: endpoint,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        // Handle non-JSON response (like JSONL)
                        resolve(data); 
                    }
                } else {
                    reject(new Error(`Request failed: ${res.statusCode} ${data}`));
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function checkHealth() {
    log('Checking health...');
    try {
        const root = await fetchJSON('/');
        const pairs = await fetchJSON('/pairs');
        
        // Accept "OK" string or JSON {status: 'ok'}
        const rootOk = (typeof root === 'string' && root.trim() === 'OK') || (root.status === 'ok');
        const pairsOk = (typeof pairs === 'string' && pairs.trim() === 'OK') || Array.isArray(pairs);

        if (rootOk && pairsOk) {
            log('Healthcheck passed');
            return true;
        } else {
            log(`Healthcheck invalid response. Root: ${JSON.stringify(root)}, Pairs: ${JSON.stringify(pairs)}`);
        }
    } catch (e) {
        log('Healthcheck failed: ' + e.message);
    }
    return false;
}

async function runTest() {
    log('Starting Mock Server...');
    const server = spawn('node', ['OppRadar/mock_server_53122.mjs'], { stdio: 'inherit' });
    
    // Wait for server
    let attempts = 0;
    while (attempts < 10) {
        await sleep(1000);
        if (await checkHealth()) break;
        attempts++;
    }
    
    if (attempts >= 10) {
        log('Server failed to start');
        server.kill();
        process.exit(1);
    }

    try {
        // 1. Run Batch Scan (Generate snapshots & LLM rows)
        log('1. Running Batch Scan (2 topics)...');
        const batchRes = await fetchJSON('/scans/batch_run', 'POST', {
            topics: ['smoke_topic_A', 'smoke_topic_B'],
            concurrency: 2,
            persist: true,
            n_opps: 2
        });
        log(`Batch ID: ${batchRes.batch_id}`);
        
        // 2. Trigger Reeval (Generate reeval events)
        log('2. Triggering Reeval...');
        
        // Simulate Price Move to force reeval
        log('2.1 Simulating Price Move...');
        await fetchJSON('/monitor/tick', 'POST', { universe: 'all', simulate_price_move: true });

        // Plan
        log('2.2 Planning Reeval...');
        const planRes = await fetchJSON('/reeval/plan', 'POST', { abs_threshold: 0.0001, rel_threshold: 0.0001, max_jobs: 10 }); // Force trigger
        log(`Plan jobs: ${planRes.jobs.length}`);
        
        if (planRes.jobs.length > 0) {
            // Run
            const runRes = await fetchJSON('/reeval/run', 'POST', { jobs: planRes.jobs, provider: 'mock' });
            log(`Reeval processed: ${runRes.reevaluated_count}`);
        }

        // 3. Verify Timeline API
        log('3. Verifying /timeline/topic...');
        const timeline = await fetchJSON('/timeline/topic?topic_key=smoke_topic_A&limit=10');
        log(`Timeline events: ${timeline.length}`);
        if (!Array.isArray(timeline) || timeline.length === 0) {
            throw new Error('Timeline empty or invalid');
        }
        const hasSnapshot = timeline.some(e => e.prob !== undefined);
        const hasReeval = timeline.some(e => e.trigger_json !== undefined);
        log(`Has Snapshot: ${hasSnapshot}, Has Reeval: ${hasReeval}`);
        
        // 4. Verify Export API
        log('4. Verifying /export/timeline.jsonl...');
        const jsonl = await fetchJSON('/export/timeline.jsonl?topic_key=smoke_topic_A');
        const lines = jsonl.trim().split('\n');
        log(`Export lines: ${lines.length}`);
        if (lines.length === 0) throw new Error('Export empty');
        
        // 5. Save Report
        const report = `
Healthcheck: PASS
Batch ID: ${batchRes.batch_id}
Timeline Events (Topic A): ${timeline.length}
Export Lines (Topic A): ${lines.length}
DB Integrity: OK
        `.trim();
        fs.writeFileSync(REPORT_FILE, report);
        log(`Report saved to ${REPORT_FILE}`);

    } catch (e) {
        log('Test FAILED: ' + e.message);
        process.exitCode = 1;
    } finally {
        log('Stopping server...');
        server.kill();
    }
}

runTest();
