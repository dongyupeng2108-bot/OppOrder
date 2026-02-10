import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;

// Utils
function post(path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(BASE_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        http.get(BASE_URL + path, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
        }).on('error', reject);
    });
}

async function runSmoke() {
    console.log('Starting Smoke Test for Top Opportunities by Run ID...');
    const evidencePath = process.argv[2] 
        ? path.resolve(process.argv[2])
        : path.resolve('rules/task-reports/2026-02/opps_top_by_run_smoke_260209_010.txt');
    console.log(`Writing evidence to: ${evidencePath}`);

    const logLines = [];
    const log = (msg) => {
        console.log(msg);
        logLines.push(msg);
    };

    log(`Test started at ${new Date().toISOString()}`);

    try {
        // 1. Build pipeline to generate run_id
        log('Step 1: Calling POST /opportunities/build_v1...');
        const jobs = [
            { symbol: 'BTC', timeframe: '1h', n_opps: 5 },
            { symbol: 'ETH', timeframe: '4h', n_opps: 5 }
        ];
        const buildRes = await post('/opportunities/build_v1', { jobs, concurrency: 2 });
        if (buildRes.status !== 200) throw new Error(`Build failed with status ${buildRes.status}`);
        
        const runId = buildRes.body.run_id;
        log(`Run ID generated: ${runId}`);
        if (!runId) throw new Error('Missing run_id in build response');

        // 2. Call /opportunities/top?run_id=...
        log(`Step 2: Calling GET /opportunities/top?run_id=${runId}&limit=10...`);
        const topRes = await get(`/opportunities/top?run_id=${runId}&limit=10`);
        
        if (topRes.status !== 200) throw new Error(`Get Top failed with status ${topRes.status}`);
        
        const topList = topRes.body;
        log(`Received ${topList.length} items.`);

        if (topList.length < 1) throw new Error('Expected at least 1 item');

        // 3. Verify
        let allSameRunId = true;
        let sorted = true;
        let prevScore = Infinity;

        topList.forEach((opp, idx) => {
            // Check run_id
            if (opp.build_run_id !== runId) {
                allSameRunId = false;
                log(`[FAIL] Item ${idx} has build_run_id=${opp.build_run_id}, expected ${runId}`);
            }

            // Check sort
            if (opp.score > prevScore) {
                sorted = false;
                log(`[FAIL] Item ${idx} score ${opp.score} > prev ${prevScore}`);
            }
            prevScore = opp.score;
        });

        if (!allSameRunId) throw new Error('Not all items belong to the requested run_id');
        if (!sorted) throw new Error('Items are not sorted by score descending');

        log('PASS: rows >= 1, all_same_run_id=true, sorted_by_score_desc=true');

        // Write Evidence
        const evidence = logLines.join('\n');
        // Ensure directory exists
        const dir = path.dirname(evidencePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(evidencePath, evidence, 'utf8');
        console.log('Evidence written successfully.');

    } catch (err) {
        log(`ERROR: ${err.message}`);
        const evidence = logLines.join('\n');
        const dir = path.dirname(evidencePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(evidencePath, evidence, 'utf8');
        process.exit(1);
    }
}

runSmoke();
