import fs from 'fs';
import path from 'path';
import http from 'http';

const BASE_URL = 'http://localhost:53122';
const REPORT_DIR = path.join(process.cwd(), 'rules/task-reports/2026-02');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

async function postJSON(path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(BASE_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data: data }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get(BASE_URL + path, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data: data }));
        });
        req.on('error', reject);
    });
}

async function run() {
    console.log('Starting Smoke Test for 260207_001...');
    
    // Run 1
    console.log('Run 1...');
    const r1 = await postJSON('/scans/run', { seed: 111, n_opps: 5, mode: 'fast' });
    if (r1.status !== 200) throw new Error('Run 1 failed: ' + r1.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260207_001_runscan_1.json'), r1.data);
    console.log('Run 1 saved.');

    // Run 2
    console.log('Run 2...');
    const r2 = await postJSON('/scans/run', { seed: 111, n_opps: 5, mode: 'fast' });
    if (r2.status !== 200) throw new Error('Run 2 failed: ' + r2.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260207_001_runscan_2.json'), r2.data);
    console.log('Run 2 saved.');

    // UI Check
    console.log('UI Check...');
    const rUI = await get('/ui/replay');
    fs.writeFileSync(path.join(REPORT_DIR, '260207_001_ui_replay_status.txt'), `GET /ui/replay -> ${rUI.status}`);
    console.log('UI Check saved.');
    
    console.log('Smoke Test Done.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
