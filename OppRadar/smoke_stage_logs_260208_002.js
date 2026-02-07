
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;
const REPORT_DIR = path.join(__dirname, '../rules/task-reports/2026-02');

// Ensure report dir exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Helpers
async function post(endpoint, body) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res;
}

async function get(endpoint) {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    return res;
}

// Tests
async function runTests() {
    console.log('Starting Smoke Test for Task 260208_002...');

    try {
        // 1. Healthcheck
        console.log('1. Checking Healthcheck...');
        const resRoot = await get('/');
        const resPairs = await get('/pairs');
        
        if (resRoot.status !== 200 || resPairs.status !== 200) {
            throw new Error(`Healthcheck failed: / -> ${resRoot.status}, /pairs -> ${resPairs.status}`);
        }
        
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_healthcheck_53122.txt'), 
            `/ -> ${resRoot.status}\n/pairs -> ${resPairs.status}\n`);
        console.log('   Healthcheck PASS');

        // 2. Run Scan
        console.log('2. Running Scan...');
        const scanParams = { seed: 111, n_opps: 5, mode: 'fast', persist: true };
        const resScan = await post('/scans/run', scanParams);
        const scanData = await resScan.json();
        
        if (resScan.status !== 200) {
            throw new Error(`Scan failed: ${resScan.status} - ${JSON.stringify(scanData)}`);
        }
        
        const stageLogs = scanData.scan.stage_logs;
        if (!stageLogs || !Array.isArray(stageLogs)) {
            throw new Error('stage_logs missing or not an array');
        }
        if (stageLogs.length < 3) {
            throw new Error(`stage_logs length < 3 (Found: ${stageLogs.length})`);
        }
        
        const requiredStages = ['gen_opps', 'score_baseline', 'llm_mock'];
        const foundStages = stageLogs.map(s => s.stage_id);
        const missingStages = requiredStages.filter(s => !foundStages.includes(s));
        
        if (missingStages.length > 0) {
            throw new Error(`Missing required stages: ${missingStages.join(', ')}`);
        }
        
        // Write evidence
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_runscan.json'), JSON.stringify(scanData, null, 2));
        console.log('   Run Scan PASS');

        // 3. Export Stage Logs
        console.log('3. Exporting Stage Logs...');
        const scanId = scanData.scan.scan_id;
        const exportUrl = `/export/stage_logs.json?scan=${scanId}`;
        const resExport = await get(exportUrl);
        
        if (resExport.status !== 200) {
            throw new Error(`Export failed: ${resExport.status}`);
        }
        
        const contentDisp = resExport.headers.get('content-disposition');
        const contentType = resExport.headers.get('content-type');
        
        if (!contentDisp || !contentDisp.includes(`filename="stage_logs_${scanId}.json"`)) {
            throw new Error(`Invalid Content-Disposition: ${contentDisp}`);
        }
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Invalid Content-Type: ${contentType}`);
        }
        
        const exportData = await resExport.json();
        if (!Array.isArray(exportData) || exportData.length !== stageLogs.length) {
            throw new Error('Exported data mismatch');
        }
        
        // Write evidence
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_export_stage_logs.json'), JSON.stringify(exportData, null, 2));
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_export_headers.txt'), 
            `Content-Disposition: ${contentDisp}\nContent-Type: ${contentType}\n`);
        console.log('   Export PASS');
        
        // 4. UI Replay Check (Simulated)
        console.log('4. Checking UI Replay Endpoint...');
        const resUi = await get(`/ui/replay?scan=${scanId}`); // Note: API endpoint is /replay?scan=... but UI page calls API. 
        // Wait, the requirement says "UI: 展示 + 导出".
        // The smoke test requirement says "260208_002_ui_replay_status.txt".
        // The mock server doesn't serve the dynamic HTML for replay, it serves static files. 
        // But `app.js` fetches `/replay?scan=...`
        // Let's check the API endpoint `/replay?scan=${scanId}`
        
        const resReplayApi = await get(`/replay?scan=${scanId}`);
        if (resReplayApi.status !== 200) {
             throw new Error(`Replay API failed: ${resReplayApi.status}`);
        }
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_ui_replay_status.txt'), `API /replay?scan=${scanId} -> ${resReplayApi.status}`);
        console.log('   UI Replay API PASS');

        console.log('ALL TESTS PASSED');

    } catch (err) {
        console.error('TEST FAILED:', err.message);
        process.exit(1);
    }
}

runTests();
