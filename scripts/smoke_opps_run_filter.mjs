import http from 'http';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const outputFileArg = args.find(arg => !arg.startsWith('--')); // Assume first non-flag arg is output file, or just use first arg if simple

const TASK_ID = '260209_008';
const REPORT_DIR = path.join(process.cwd(), 'rules/task-reports/2026-02');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

// Use provided output file if available, else default to hardcoded
const LOG_FILE = outputFileArg ? path.resolve(outputFileArg) : path.join(REPORT_DIR, `opps_run_filter_smoke_${TASK_ID}.txt`);

// Clear log
fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Starting Smoke Test for ${TASK_ID}\n`);

function log(msg) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + '\n');
}

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 53122,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        const json = data ? JSON.parse(data) : {};
                        resolve(json);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// Retry helper for build_v1
async function retryRequest(fn, retries = 3, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) throw e;
            log(`[Retry] Request failed: ${e.message}. Retrying in ${delayMs}ms...`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

async function run() {
    try {
        log('1. Triggering POST /opportunities/build_v1...');
        const buildRes = await retryRequest(() => request('POST', '/opportunities/build_v1', {
            jobs: [
                { seed: 101, n_opps: 2, topic_key: 'smoke_run_filter_1' },
                { seed: 102, n_opps: 2, topic_key: 'smoke_run_filter_2' }
            ],
            concurrency: 2
        }));

        const runId = buildRes.run_id;
        log(`   => run_id=${runId}`);
        if (!runId) throw new Error('No run_id returned from build_v1');

        log('2. Verifying GET /opportunities/runs...');
        const runsRes = await request('GET', '/opportunities/runs?limit=10');
        const foundRun = runsRes.find(r => r.run_id === runId);
        
        if (foundRun) {
            log(`   => Found run in list: ${JSON.stringify(foundRun)}`);
        } else {
            throw new Error(`Run ${runId} not found in /opportunities/runs`);
        }
        
        // Log DoD marker for runs list
        log(`DOD_EVIDENCE_OPPS_RUNS_LIST: ${LOG_FILE} => contains_run_id=true count=${runsRes.length}`);

        log('3. Verifying GET /opportunities/by_run...');
        const byRunRes = await request('GET', `/opportunities/by_run?run_id=${runId}&limit=10`);
        
        log(`   => Returned ${byRunRes.length} opportunities`);
        if (byRunRes.length === 0) throw new Error('No opportunities returned for run');
        
        const allMatch = byRunRes.every(o => o.build_run_id === runId || (o.refs && o.refs.run_id === runId));
        // Note: db.mjs stores build_run_id column. 
        // Let's verify specifically.
        
        if (!allMatch) {
            const bad = byRunRes.find(o => o.build_run_id !== runId);
            throw new Error(`Found opportunity with wrong run_id: ${JSON.stringify(bad)}`);
        }
        
        log(`   => All ${byRunRes.length} opportunities match run_id`);

        // Log DoD marker for by_run
        log(`DOD_EVIDENCE_OPPS_BY_RUN: ${LOG_FILE} => rows=${byRunRes.length} all_same_run_id=true`);

        log('PASS: true');
    } catch (e) {
        log(`FAIL: ${e.message}`);
        process.exit(1);
    }
}

run();
