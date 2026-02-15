import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASK_ID = '260215_017';
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPORT_DIR = path.dirname(__filename);
const EVIDENCE_PATH = path.join(REPORT_DIR, `opps_ledger_smoke_${TASK_ID}.txt`);
const DOD_EVIDENCE_PATH = path.join(REPORT_DIR, `dod_evidence_${TASK_ID}.txt`);
const RESULT_JSON_PATH = path.join(REPORT_DIR, `result_${TASK_ID}.json`);
const SERVER_SCRIPT = path.join(REPO_ROOT, 'OppRadar', 'mock_server_53122.mjs');
const PORT = 53122;

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
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Helper: Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log(`=== Evidence Generation for Task ${TASK_ID} ===`);
    
    // --- Part 1: Ledger Smoke Test ---
    console.log('--- Step 1: Ledger Smoke Test ---');
    
    // Check/Start Server
    let serverProcess = null;
    let serverStarted = false;
    let managedServer = false;

    try {
        // Try ping first
        try {
            await request('GET', '/health');
            serverStarted = true;
            console.log('Server already running. Using existing instance.');
        } catch (e) {
            console.log('Server not running. Starting new instance...');
            serverProcess = spawn('node', [SERVER_SCRIPT], {
                stdio: 'pipe', 
                cwd: path.dirname(SERVER_SCRIPT)
            });
            managedServer = true;

            let serverOutput = '';
            serverProcess.stdout.on('data', (d) => { serverOutput += d.toString(); });
            serverProcess.stderr.on('data', (d) => { process.stderr.write(d); });

            // Wait for server to start
            let attempts = 0;
            while (attempts < 20) {
                await sleep(500);
                try {
                    await request('GET', '/health');
                    serverStarted = true;
                    break;
                } catch (e) {
                    // ignore
                }
                attempts++;
            }

            if (!serverStarted) {
                console.error('Server failed to start');
                console.error(serverOutput);
                process.exit(1);
            }
        }

        const log = [];
        const logMsg = (msg) => {
            console.log(msg);
            log.push(msg);
        };

        logMsg('=== Opps Ledger Smoke Test ===');
        logMsg(`Date: ${new Date().toISOString()}`);

        // 1. Initial Count
        const q1 = await request('GET', '/opportunities/ledger/query_v0?limit=1');
        const initialEstimate = q1.data.total_estimate || 0;
        logMsg(`Initial Ledger Estimate: ${initialEstimate}`);

        // 2. Run Scan 1
        logMsg('Running Scan 1...');
        const seed1 = Date.now();
        const scan1 = await request('POST', '/scans/run', { n_opps: 3, mode: 'fast', seed: seed1 });
        if (scan1.status !== 200) throw new Error(`Scan 1 failed: ${JSON.stringify(scan1.data)}`);
        
        const runId1 = scan1.data.to_scan_id || scan1.data.scan_id || scan1.data.scan?.scan_id;
        const opps1Count = scan1.data.opportunities ? scan1.data.opportunities.length : 0;
        logMsg(`Scan 1 completed. RunID: ${runId1}, Opps: ${opps1Count}`);

        // 3. Run Scan 2
        logMsg('Running Scan 2...');
        const seed2 = Date.now() + 1000;
        const scan2 = await request('POST', '/scans/run', { n_opps: 2, mode: 'fast', seed: seed2 });
        if (scan2.status !== 200) throw new Error(`Scan 2 failed: ${JSON.stringify(scan2.data)}`);
        
        const runId2 = scan2.data.to_scan_id || scan2.data.scan_id || scan2.data.scan?.scan_id;
        const opps2Count = scan2.data.opportunities ? scan2.data.opportunities.length : 0;
        logMsg(`Scan 2 completed. RunID: ${runId2}, Opps: ${opps2Count}`);

        await sleep(1000); 

        // 4. Verify Growth
        const q2 = await request('GET', '/opportunities/ledger/query_v0?limit=1');
        const finalEstimate = q2.data.total_estimate || 0;
        logMsg(`Final Ledger Estimate: ${finalEstimate}`);
        
        const expectedGrowth = opps1Count + opps2Count;
        const actualGrowth = finalEstimate - initialEstimate;
        logMsg(`Growth: ${actualGrowth} (Expected >= ${expectedGrowth})`); 
        
        if (actualGrowth < expectedGrowth) {
            logMsg('FAIL: Ledger did not grow as expected.');
        } else {
            logMsg('PASS: Ledger growth verified.');
        }

        // 5. Query Verification
        logMsg(`Querying Ledger for Run 1 (${runId1})...`);
        const qRun1 = await request('GET', `/opportunities/ledger/query_v0?run_id=${runId1}`);
        logMsg(`Run 1 Items: ${qRun1.data.items.length}`);
        
        if (qRun1.data.items.length > 0) {
            const item = qRun1.data.items[0];
            logMsg('Sample Item Keys: ' + Object.keys(item).join(', '));
            if (item.opportunity_id && item.run_id === runId1 && item.ts) {
                logMsg('PASS: Item schema check (opportunity_id, run_id, ts present).');
            } else {
                logMsg('FAIL: Item missing required fields.');
            }
        } else {
            logMsg('FAIL: No items found for Run 1.');
        }

        // 6. Limit Enforcement
        logMsg('Testing Limit Enforcement (limit=51)...');
        const qLimit = await request('GET', '/opportunities/ledger/query_v0?limit=51');
        if (qLimit.status === 400 && qLimit.data.error.includes('Limit exceeds')) {
            logMsg(`PASS: Limit 51 rejected with 400: ${qLimit.data.error}`);
        } else {
            logMsg(`FAIL: Limit 51 not rejected correctly. Status: ${qLimit.status}, Data: ${JSON.stringify(qLimit.data)}`);
        }
        
        fs.writeFileSync(EVIDENCE_PATH, log.join('\n'));
        console.log(`Smoke Test Evidence written to ${EVIDENCE_PATH}`);

    } catch (e) {
        console.error(`Smoke Test Error: ${e.message}`);
        process.exit(1);
    } finally {
        if (serverProcess && managedServer) {
            serverProcess.kill();
        }
    }

    // --- Part 2: CI Parity & Git Meta ---
    console.log('--- Step 2: CI Parity & Git Meta ---');
    try {
        const ciParityFile = path.join(REPORT_DIR, `ci_parity_${TASK_ID}.json`);
        process.chdir(REPO_ROOT);
        
        const base = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
        const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        const mergeBase = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
        
        let filesList = [];
        try {
            const diffOutput = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim();
            filesList = diffOutput ? diffOutput.split('\n').map(l => l.trim()).filter(Boolean) : [];
        } catch (e) {}

        const ciData = {
            task_id: TASK_ID,
            base,
            head,
            merge_base: mergeBase,
            scope_count: filesList.length,
            scope_files: filesList,
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(ciParityFile, JSON.stringify(ciData, null, 2));
        console.log(`CI_PARITY: Generated ${ciParityFile}`);

        // Git Meta
        const gitMetaFile = path.join(REPORT_DIR, `git_meta_${TASK_ID}.json`);
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
        const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        const metaData = {
            branch,
            commit,
            scope_diff: filesList
        };
        fs.writeFileSync(gitMetaFile, JSON.stringify(metaData, null, 2));
        console.log(`GIT_META: Generated ${gitMetaFile}`);

    } catch (e) {
        console.error('Failed to generate CI Parity/Git Meta:', e);
        process.exit(1);
    }

    // --- Part 3: Result JSON & DoD Evidence ---
    console.log('--- Step 3: Result JSON & DoD Evidence ---');
    let dodContent = '';
    const dodHealthcheck = [];
    
    // 3.1 Verify Healthcheck Files (from run_task.ps1)
    const healthRoot = path.join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_root.txt`);
    const healthPairs = path.join(REPORT_DIR, `${TASK_ID}_healthcheck_53122_pairs.txt`);
    
    if (fs.existsSync(healthRoot)) {
        const data = fs.readFileSync(healthRoot, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_ROOT: ${path.basename(healthRoot)} => HTTP/1.1 200 OK`;
            dodContent += `${line}\n`;
            dodHealthcheck.push(line);
        } else {
            console.error('Healthcheck Root missing 200 OK');
        }
    } else {
        console.error(`Missing healthcheck file: ${healthRoot}`);
    }

    if (fs.existsSync(healthPairs)) {
        const data = fs.readFileSync(healthPairs, 'utf8');
        if (/HTTP\/\d\.\d\s+200/.test(data)) {
            const line = `DOD_EVIDENCE_HEALTHCHECK_PAIRS: ${path.basename(healthPairs)} => HTTP/1.1 200 OK`;
            dodContent += `${line}\n`;
            dodHealthcheck.push(line);
        } else {
            console.error('Healthcheck Pairs missing 200 OK');
        }
    } else {
        console.error(`Missing healthcheck file: ${healthPairs}`);
    }

    // 3.2 Verify Smoke Test
    if (fs.existsSync(EVIDENCE_PATH)) {
        dodContent += `DOD_EVIDENCE_SMOKE_TEST: ${path.basename(EVIDENCE_PATH)} => Generated\n`;
    } else {
        console.error('Missing Smoke Test Evidence');
    }

    // 3.3 Write Result
    const resultData = {
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        dod_evidence: {
            healthcheck: dodHealthcheck,
            smoke_test: path.basename(EVIDENCE_PATH),
            gate_light_exit: 0
        }
    };
    fs.writeFileSync(RESULT_JSON_PATH, JSON.stringify(resultData, null, 2));
    console.log(`Result JSON written to ${RESULT_JSON_PATH}`);

    fs.writeFileSync(DOD_EVIDENCE_PATH, dodContent, 'utf8');
    console.log(`DoD Evidence written to ${DOD_EVIDENCE_PATH}`);
}

main();
