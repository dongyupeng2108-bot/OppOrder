import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// We are running from scripts/ (after move) or OppRadar/ (before move).
// If we run from scripts/, ROOT is ..
// If we run from OppRadar/, ROOT is ..
// Let's assume this script will be located in scripts/ when run.
const ROOT_DIR = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT_DIR, 'rules/task-reports/2026-02');

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const SERVER_SCRIPT = path.join(ROOT_DIR, 'OppRadar/mock_server_53122.mjs');
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    for (let i = 0; i < 20; i++) {
        try {
            const res = await fetch(`${BASE_URL}/`);
            if (res.ok) return true;
        } catch (e) {}
        await sleep(500);
    }
    throw new Error('Server failed to start');
}

async function run() {
    console.log('Starting mock server...');
    const server = spawn('node', [SERVER_SCRIPT], {
        stdio: 'inherit',
        env: { ...process.env, LLM_PROVIDER: 'mock' } // Force mock for smoke test
    });

    try {
        await waitForServer();
        console.log('Server is up.');

        // 1. Run Scan
        console.log('Running scan...');
        const scanRes = await fetch(`${BASE_URL}/scans/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ n_opps: 5, seed: 111, mode: 'fast' })
        });
        if (!scanRes.ok) throw new Error('Scan failed');
        const scanData = await scanRes.json();
        const scanId = scanData.scan.scan_id;
        console.log(`Scan completed: ${scanId}`);

        // 2. Plan Reeval
        console.log('Planning reeval...');
        const planRes = await fetch(`${BASE_URL}/reeval/plan?scan=${scanId}`, { method: 'POST' });
        if (!planRes.ok) throw new Error('Reeval plan failed');
        
        // 3. Run Reeval
        console.log('Running reeval...');
        const runRes = await fetch(`${BASE_URL}/reeval/run?scan=${scanId}`, { method: 'POST' });
        if (!runRes.ok) throw new Error('Reeval run failed');
        const runData = await runRes.json();
        console.log(`Reeval completed. Processed: ${runData.reevaluated_count}`);

        // 4. Export Dataset
        console.log('Exporting dataset...');
        const exportRes = await fetch(`${BASE_URL}/export/llm_dataset.jsonl?scan=${scanId}`);
        if (!exportRes.ok) {
            const errText = await exportRes.text();
            throw new Error(`Export failed: ${exportRes.status} ${exportRes.statusText} - ${errText}`);
        }
        
        // Check Headers
        const contentType = exportRes.headers.get('content-type');
        const contentDisposition = exportRes.headers.get('content-disposition');
        
        console.log(`Content-Type: ${contentType}`);
        console.log(`Content-Disposition: ${contentDisposition}`);
        
        if (!contentType.includes('application/jsonl')) throw new Error('Invalid Content-Type');
        if (!contentDisposition.includes(`filename="llm_dataset_${scanId}.jsonl"`)) throw new Error('Invalid Content-Disposition');

        // Check Content
        const text = await exportRes.text();
        const lines = text.trim().split('\n');
        console.log(`Received ${lines.length} rows.`);

        const rows = lines.map(line => JSON.parse(line));
        
        // Validation
        const checks = {
            rowCount: lines.length >= 5,
            validJSON: true,
            requiredFields: true,
            hasReevalTrigger: false
        };

        rows.forEach(row => {
            if (!row.ids || !row.provider || !row.input || !row.output || !row.snapshot || !row.scoring || !row.trigger || !row.hash) {
                checks.requiredFields = false;
                console.error('Missing fields in row:', row);
            }
            if (row.trigger.trigger_reason && row.trigger.trigger_reason !== 'initial') {
                checks.hasReevalTrigger = true;
            }
        });

        const result = {
            timestamp: new Date().toISOString(),
            status: 'PASS',
            checks,
            scanId,
            rowCount: lines.length,
            sample: rows.slice(0, 3)
        };

        if (!checks.rowCount || !checks.requiredFields) {
            result.status = 'FAIL';
            throw new Error('Validation failed: ' + JSON.stringify(checks));
        }

        fs.writeFileSync(path.join(REPORT_DIR, '260208_008_smoke_result.json'), JSON.stringify(result, null, 2));
        console.log('Smoke test passed. Result written.');
        console.log('---RESULT_JSON_START---');
        console.log(JSON.stringify(result, null, 2));
        console.log('---RESULT_JSON_END---');

    } catch (err) {
        // If file write failed, maybe permission error
        if (err.code === 'EACCES' || err.code === 'EPERM') {
             console.log('File write permission denied, printing result to stdout:');
             // We can't access result here easily if it wasn't defined in outer scope, 
             // but we can just rely on the console log above if it reached there.
             // If it failed BEFORE file write, we are in catch.
        }
        console.error('Smoke test failed:', err);
        process.exit(1);
    } finally {
        server.kill();
    }
}

run();
