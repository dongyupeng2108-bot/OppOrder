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
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: data }));
        });
        req.on('error', reject);
    });
}

async function run() {
    console.log('Starting Smoke Test for 260208_003 (Monitor+Trigger+Reeval)...');
    
    // 1. RunScan (Init data)
    console.log('1. RunScan...');
    const r1 = await postJSON('/scans/run', { seed: 123, n_opps: 10, persist: true, max_n_opps: 10 });
    if (r1.status !== 200) throw new Error('RunScan failed: ' + r1.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_runscan.json'), r1.data);
    const scanData = JSON.parse(r1.data);
    console.log(`   Scan OK. Opps: ${scanData.opportunities.length}`);

    // 2. Monitor Tick (Simulate Move)
    console.log('2. Monitor Tick...');
    const r2 = await postJSON('/monitor/tick', { universe: 'all', simulate_price_move: true });
    if (r2.status !== 200) throw new Error('Monitor Tick failed: ' + r2.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_monitor_tick.json'), r2.data);
    const tickData = JSON.parse(r2.data);
    console.log(`   Tick OK. Updated: ${tickData.updated_count}, Changed: ${tickData.changed_count}`);

    // 3. Reeval Plan (Trigger)
    console.log('3. Reeval Plan...');
    // Use low thresholds to force triggers
    const planParams = { 
        abs_threshold: 0.05, 
        rel_threshold: 0.05, 
        speed_threshold: 0.1, 
        staleness_min: 0, 
        hysteresis_reset: 0.02,
        max_jobs: 5
    };
    const r3 = await postJSON('/reeval/plan', planParams);
    if (r3.status !== 200) throw new Error('Reeval Plan failed: ' + r3.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_reeval_plan.json'), r3.data);
    const planData = JSON.parse(r3.data);
    console.log(`   Plan OK. Jobs: ${planData.jobs.length}`);
    
    if (planData.jobs.length === 0) {
        console.warn('   WARNING: No jobs generated. Smoke test might be less effective.');
    }

    // 4. Reeval Run (Execute)
    console.log('4. Reeval Run...');
    const r4 = await postJSON('/reeval/run', { jobs: planData.jobs, provider: 'mock' });
    if (r4.status !== 200) throw new Error('Reeval Run failed: ' + r4.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_reeval_run.json'), r4.data);
    const runData = JSON.parse(r4.data);
    console.log(`   Run OK. Reevaluated: ${runData.reevaluated_count}`);

    // 5. Export Monitor State
    console.log('5. Export Monitor State...');
    const r5 = await get('/export/monitor_state.json');
    if (r5.status !== 200) throw new Error('Export failed: ' + r5.status);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_export_monitor_state.json'), r5.data);
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_export_headers.txt'), JSON.stringify(r5.headers, null, 2));
    console.log('   Export OK.');

    // 6. UI Status
    console.log('6. UI Status Check...');
    const rUI = await get('/ui/replay');
    fs.writeFileSync(path.join(REPORT_DIR, '260208_003_ui_status.txt'), `GET /ui/replay -> ${rUI.status}`);
    console.log('   UI Status OK.');
    
    console.log('Smoke Test Done.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
