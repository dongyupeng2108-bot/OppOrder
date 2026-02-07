const http = require('http');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '../rules/task-reports/2026-02');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

async function postJSON(urlPath, data) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 53122,
            path: urlPath,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, data: body }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function runPerf(persist, label) {
    const durations = [];
    console.log(`Starting Perf Test: ${label} (persist=${persist})...`);
    
    for (let i = 0; i < 5; i++) {
        const res = await postJSON('/scans/run', { seed: 100 + i, n_opps: 50, mode: 'fast', persist });
        if (res.status !== 200) throw new Error(`Run ${i} failed: ${res.status}`);
        
        const json = JSON.parse(res.data);
        const duration = json.scan.metrics.total_ms;
        durations.push(duration);
        
        // Save first run as evidence
        if (i === 0) {
            fs.writeFileSync(path.join(REPORT_DIR, `260207_003_raw_${label}.json`), JSON.stringify(json, null, 2));
        }
    }
    return durations;
}

function calcStats(nums) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { min, max, avg, samples: nums };
}

async function main() {
    try {
        const statsA = calcStats(await runPerf(false, 'persist_off'));
        const statsB = calcStats(await runPerf(true, 'persist_on'));
        
        const summary = {
            task_id: '260207_003',
            timestamp: new Date().toISOString(),
            persist_off: statsA,
            persist_on: statsB
        };
        
        fs.writeFileSync(path.join(REPORT_DIR, '260207_003_perf_summary.json'), JSON.stringify(summary, null, 2));
        console.log('Perf Test Done. Summary saved.');
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
