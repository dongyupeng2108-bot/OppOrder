
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = 53122;
const BASE_URL = `http://localhost:${PORT}`;
const TASK_ID = '260208_011';
const REPORT_DIR = path.join(__dirname, '../rules/task-reports/2026-02');

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Helpers
async function request(method, path, body = null) {
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
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`ASSERTION FAILED: ${message}`);
    }
    console.log(`PASS: ${message}`);
}

async function runSmokeTest() {
    console.log(`Starting Smoke Test for Task ${TASK_ID}...`);
    const results = { tests: [], summary: 'PENDING' };
    
    try {
        // 1. Healthcheck
        console.log('\n--- 1. Healthcheck ---');
        const healthRoot = await request('GET', '/');
        assert(healthRoot.statusCode === 200, 'Root / should return 200');
        const healthPairs = await request('GET', '/pairs');
        assert(healthPairs.statusCode === 200, '/pairs should return 200');
        
        // Write Healthcheck Evidence
        const healthContent = `GET / -> ${healthRoot.statusCode}\nGET /pairs -> ${healthPairs.statusCode}\nTimestamp: ${new Date().toISOString()}`;
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_healthcheck_53122.txt`), healthContent);
        console.log('Healthcheck evidence written.');

        // 2. Test A: Normal Batch Run (3 topics)
        console.log('\n--- 2. Test A: Normal Batch Run ---');
        const batchParamsA = {
            topics: ['topic_A1', 'topic_A2', 'topic_A3'],
            concurrency: 2,
            n_opps: 2,
            seed: 123
        };
        const resA = await request('POST', '/scans/batch_run', batchParamsA);
        assert(resA.statusCode === 200, 'Batch run A should return 200');
        const bodyA = JSON.parse(resA.body);
        assert(bodyA.batch_id, 'Batch ID should exist');
        assert(bodyA.results.length === 3, 'Should have 3 results');
        assert(bodyA.summary_metrics.success_count === 3, 'All 3 should succeed');
        assert(bodyA.results.every(r => r.topic_status === 'OK'), 'All topics status OK');
        
        const batchIdA = bodyA.batch_id;
        console.log(`Batch A ID: ${batchIdA}`);

        // 3. Test B: Fail-Soft (1 failed topic)
        console.log('\n--- 3. Test B: Fail-Soft ---');
        const batchParamsB = {
            topics: [
                { topic_key: 'topic_B1', n_opps: 2 },
                { topic_key: 'topic_B_FAIL', n_opps: 0 } // Invalid n_opps should fail
            ],
            concurrency: 2
        };
        const resB = await request('POST', '/scans/batch_run', batchParamsB);
        assert(resB.statusCode === 200, 'Batch run B should return 200 (Fail-Soft)');
        const bodyB = JSON.parse(resB.body);
        assert(bodyB.results.length === 2, 'Should have 2 results');
        const failedTopic = bodyB.results.find(r => r.topic_key === 'topic_B_FAIL');
        const okTopic = bodyB.results.find(r => r.topic_key === 'topic_B1');
        assert(failedTopic && failedTopic.topic_status === 'FAILED', 'Invalid topic should be FAILED');
        assert(okTopic && okTopic.topic_status === 'OK', 'Valid topic should be OK');
        assert(bodyB.summary_metrics.failed_count === 1, 'Summary should show 1 failure');

        // 4. Test C: Dedup Skip
        console.log('\n--- 4. Test C: Dedup Skip ---');
        // Re-run topic_A1 with dedup window
        const batchParamsC = {
            topics: ['topic_A1'],
            dedup_window_sec: 3600, // Large window
            dedup_mode: 'skip',
            seed: 123 // Same seed as A
        };
        const resC = await request('POST', '/scans/batch_run', batchParamsC);
        const bodyC = JSON.parse(resC.body);
        const skippedTopic = bodyC.results[0];
        
        // Wait for server fix propagation or verify directly
        if (skippedTopic.topic_status === 'SKIPPED') {
            console.log('PASS: Dedup Skip works (status: SKIPPED)');
        } else {
             // If failed, it might be due to server not reloading?
             // Or maybe dedup logic issue.
             // We'll assert it anyway.
             console.log('WARNING: Dedup Skip status is ' + skippedTopic.topic_status);
        }
        assert(skippedTopic.topic_status === 'SKIPPED', 'Topic should be SKIPPED due to dedup');
        assert(bodyC.summary_metrics.skipped_count === 1, 'Summary skipped count 1');
        
        console.log('WARNING: Dedup Test might fail if dedup_mode not passed. Checking...');
        
        // 5. Test D: Export Evidence
        console.log('\n--- 5. Test D: Export Evidence ---');
        const resExport = await request('GET', `/export/batch_run.json?batch_id=${batchIdA}`);
        assert(resExport.statusCode === 200, 'Export should return 200');
        assert(resExport.headers['content-type'].includes('application/json'), 'Content-Type JSON');
        assert(resExport.headers['content-disposition'].includes(`batch_run_${batchIdA}.json`), 'Filename correct');
        
        const exportBody = JSON.parse(resExport.body);
        assert(exportBody.batch_id === batchIdA, 'Exported Batch ID matches');
        assert(exportBody.results.length === 3, 'Exported results count matches');

        // Write Export Evidence
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_export_headers.txt`), JSON.stringify(resExport.headers, null, 2));
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_export_body_sample.json`), JSON.stringify(exportBody, null, 2));

        results.summary = 'PASS';
        results.tests = ['Healthcheck', 'Normal Batch', 'Fail-Soft', 'Dedup (Partial)', 'Export'];
        
        // Write Smoke Result
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_smoke_result.json`), JSON.stringify(results, null, 2));
        console.log('\nSmoke Test PASSED! Results written.');

    } catch (err) {
        console.error('\nSmoke Test FAILED:', err);
        results.summary = 'FAILED';
        results.error = err.message;
        fs.writeFileSync(path.join(REPORT_DIR, `${TASK_ID}_smoke_result.json`), JSON.stringify(results, null, 2));
        process.exit(1);
    }
}

runSmokeTest();
