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
    console.log('Starting Smoke Test for Opportunity Pipeline v1...');
    // Support custom output path (argv[2]) or default to historical 006 path
    const evidencePath = process.argv[2] 
         ? path.resolve(process.argv[2]) 
         : path.resolve('rules/task-reports/2026-02/opps_pipeline_smoke_260209_006.txt');
     
     console.log(`Writing evidence to: ${evidencePath}`); // DEBUG log
     
     const logLines = [];

    const log = (msg) => {
        console.log(msg);
        logLines.push(msg);
    };

    log(`Test started at ${new Date().toISOString()}`);

    try {
        // 1. POST /opportunities/build_v1
        const jobs = [
            { symbol: 'BTC', timeframe: '1h', n_opps: 5 },
            { symbol: 'ETH', timeframe: '4h', n_opps: 5 },
            { symbol: 'SOL', timeframe: '15m', n_opps: 5 },
            { symbol: 'DOGE', timeframe: '1d', n_opps: 5 },
            { symbol: 'XRP', timeframe: '30m', n_opps: 5 },
            { symbol: 'FAIL_TEST', timeframe: '1h', n_opps: -1 } // Fail
        ];

        log('Step 1: Calling POST /opportunities/build_v1 with 5 OK + 1 Failed jobs...');
        const buildRes = await post('/opportunities/build_v1', { jobs, concurrency: 3 });
        
        if (buildRes.status !== 200) throw new Error(`Build failed with status ${buildRes.status}`);
        
        const runId = buildRes.body.run_id;
        log(`Response received. Run ID: ${runId}`);
        log(`jobs_ok: ${buildRes.body.jobs_ok}, jobs_failed: ${buildRes.body.jobs_failed}`);

        if (!runId) throw new Error('Missing run_id');
        if (buildRes.body.jobs_ok !== 5) throw new Error(`Expected 5 OK jobs, got ${buildRes.body.jobs_ok}`);
        if (buildRes.body.jobs_failed !== 1) throw new Error(`Expected 1 Failed job, got ${buildRes.body.jobs_failed}`);

        log('PASS: Fail-soft isolation verified.');

        // 2. GET /opportunities/top
        log('Step 2: Calling GET /opportunities/top?limit=5...');
        const topRes = await get('/opportunities/top?limit=5');
        
        if (topRes.status !== 200) throw new Error(`Get Top failed with status ${topRes.status}`);
        
        const topList = topRes.body;
        log(`Received ${topList.length} top opportunities.`);
        
        if (topList.length !== 5) throw new Error(`Expected 5 top items, got ${topList.length}`);

        let hasProviderInfo = false;
        let refsRunIdVerified = true;

        topList.forEach((opp, idx) => {
            const refs = opp.refs || {};
            log(`Opp [${idx}] ${opp.topic_key}: Score=${opp.score}, RunID=${refs.run_id}`);
            
            if (refs.run_id !== runId) {
                // It's possible old opportunities are returned if score is higher, 
                // but since we just built new ones, they usually bubble up if fresh.
                // However, user requirement says "top 返回 5 条且每条包含 score 与 refs.run_id".
                // If the system has pre-existing data, this might fail if old data is better.
                // For smoke test, we assume fresh data wins or we clear DB. 
                // But mock server is persistent-ish. 
                // Let's just warn if run_id mismatches but generally we expect it to match 
                // because we just inserted fresh items.
                // Actually, let's strictly check if refs.run_id is present, not necessarily equal to THIS run_id 
                // (though for clean environment it should be).
                // User requirement: "top 返回 5 条且每条包含 score 与 refs.run_id" -> Just needs to have A run_id.
                // But for verification of THIS pipeline, it's better if it matches.
                // Let's strict check existence first.
            }
            if (!refs.run_id) {
                refsRunIdVerified = false;
                log(`ERROR: Opp ${opp.topic_key} missing refs.run_id`);
            }
            if (refs.provider_used || refs.cached) {
                hasProviderInfo = true;
            }
        });

        if (!refsRunIdVerified) throw new Error('Some opportunities missing refs.run_id');
        if (!hasProviderInfo) throw new Error('No opportunity contains provider_used/cached info in refs');

        log('PASS: Top list verification successful.');
        log('PASS: true');

    } catch (err) {
        log(`FAIL: ${err.message}`);
        log('PASS: false');
        process.exitCode = 1;
    } finally {
        // Ensure directory exists
        const dir = path.dirname(evidencePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        // Retry logic for EBUSY
        let written = false;
        let retries = 3;
        while (retries > 0 && !written) {
            try {
                fs.writeFileSync(evidencePath, logLines.join('\n'));
                written = true;
                console.log(`Evidence written to ${evidencePath}`);
            } catch (e) {
                console.error(`Write failed: ${e.message}. Retries left: ${retries-1}`);
                if (retries > 1) await new Promise(r => setTimeout(r, 1000));
                retries--;
            }
        }
        if (!written) {
            console.error('Failed to write evidence file after retries.');
            process.exit(1);
        }
    }
}

runSmoke();
