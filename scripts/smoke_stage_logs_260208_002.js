import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjusted path to point to repo root rules from scripts/
const REPORT_DIR = path.join(__dirname, '../rules/task-reports/2026-02');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:53122';

async function run() {
    console.log("Starting smoke test...");

    // 1. Healthcheck
    try {
        const hRes = await fetch(`${BASE_URL}/`);
        if (hRes.status !== 200) throw new Error(`Healthcheck failed: ${hRes.status}`);
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_healthcheck_53122.txt'), `GET / -> ${hRes.status}\n`);
        
        const hPairs = await fetch(`${BASE_URL}/pairs`);
        if (hPairs.status !== 200) throw new Error(`Healthcheck pairs failed: ${hPairs.status}`);
        fs.appendFileSync(path.join(REPORT_DIR, '260208_002_healthcheck_53122.txt'), `GET /pairs -> ${hPairs.status}\n`);
        
        const hUi = await fetch(`${BASE_URL}/ui/replay`);
        if (hUi.status !== 200) throw new Error(`UI Replay check failed: ${hUi.status}`);
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_ui_replay_status.txt'), `GET /ui/replay -> ${hUi.status}\n`);

    } catch (e) {
        console.error("Healthcheck Error:", e);
        process.exit(1);
    }

    // 2. Run Scan
    let scanId;
    try {
        console.log("Running scan...");
        const res = await fetch(`${BASE_URL}/scans/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seed: 111, n_opps: 5, mode: 'fast', persist: true })
        });
        
        if (!res.ok) throw new Error(`Run Scan failed: ${res.status}`);
        const data = await res.json();
        
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_runscan.json'), JSON.stringify(data, null, 2));
        
        scanId = data.scan.scan_id;
        const logs = data.stage_logs || [];
        
        console.log(`Scan ID: ${scanId}, Logs: ${logs.length}`);
        
        if (logs.length < 3) throw new Error(`Expected >= 3 stage logs, got ${logs.length}`);
        
        const hasIds = logs.every(l => l.stage_id && l.dur_ms !== undefined);
        if (!hasIds) throw new Error("Some logs missing stage_id or dur_ms");
        
    } catch (e) {
        console.error("Run Scan Error:", e);
        process.exit(1);
    }

    // 3. Export Stage Logs
    try {
        console.log("Exporting logs...");
        const res = await fetch(`${BASE_URL}/export/stage_logs.json?scan=${scanId}`);
        if (res.status !== 200) throw new Error(`Export failed: ${res.status}`);
        
        const disp = res.headers.get('content-disposition');
        const type = res.headers.get('content-type');
        
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_export_headers.txt'), `Content-Type: ${type}\nContent-Disposition: ${disp}\n`);
        
        if (!disp || !disp.includes('attachment') || !disp.includes('filename')) {
            throw new Error(`Invalid Content-Disposition: ${disp}`);
        }
        
        const json = await res.json();
        fs.writeFileSync(path.join(REPORT_DIR, '260208_002_export_stage_logs.json'), JSON.stringify(json, null, 2));
        
        if (json.length < 3) throw new Error(`Exported logs length mismatch: ${json.length}`);
        
    } catch (e) {
        console.error("Export Error:", e);
        process.exit(1);
    }

    console.log("Smoke Test Passed!");
}

run();
