import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 53122;
// Default to Dev path if not specified
let OUTPUT_FILE = 'data/runtime/scan_cache_smoke_dev.txt';
const outArg = process.argv.find(arg => arg.startsWith('--output='));
if (outArg) {
    OUTPUT_FILE = outArg.split('=')[1];
}

// Ensure output dir exists
const dir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

async function run() {
    const runId = Date.now().toString();
    // Unique params for this run to ensure Cache Miss on first try
    const params = JSON.stringify({ 
        n_opps: 1, 
        mode: 'fast', 
        smoke_run_id: runId 
    });
    
    console.log(`Starting Scan Cache Smoke Test (RunID: ${runId})...`);
    
    // Helper to request with fixed params
    const doReq = () => new Promise((resolve, reject) => {
        const start = Date.now();
        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: '/scans/run',
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(params)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const duration = Date.now() - start;
                try {
                    const json = JSON.parse(body);
                    resolve({ json, duration, status: res.statusCode });
                } catch (e) {
                    resolve({ error: e.message, body, duration, status: res.statusCode });
                }
            });
        });
        req.on('error', reject);
        req.write(params);
        req.end();
    });

    try {
        // Request 1
        console.log('Sending Request 1...');
        const res1 = await doReq();
        
        // Request 2
        console.log('Sending Request 2...');
        const res2 = await doReq();

        const outputLines = [];
        outputLines.push(`Timestamp: ${new Date().toISOString()}`);
        outputLines.push(`RunID: ${runId}`);
        outputLines.push('--- Request 1 ---');
        outputLines.push(`Status: ${res1.status}`);
        outputLines.push(`Cached: ${res1.json.cached}`);
        outputLines.push(`CacheKey: ${res1.json.cache_key}`);
        outputLines.push(`Duration: ${res1.duration}ms`);
        
        outputLines.push('--- Request 2 ---');
        outputLines.push(`Status: ${res2.status}`);
        outputLines.push(`Cached: ${res2.json.cached}`);
        outputLines.push(`CacheKey: ${res2.json.cache_key}`);
        outputLines.push(`Duration: ${res2.duration}ms`);
        
        // Verification Logic
        const pass = res1.json.cached === false && 
                     res2.json.cached === true && 
                     res1.json.cache_key === res2.json.cache_key;
        
        outputLines.push('--- Verification ---');
        outputLines.push(`PASS: ${pass}`);
        
        if (!pass) {
            console.error('Smoke Test FAILED');
            if (res1.json.cached) outputLines.push('FAIL: First request was cached (unexpected for new run_id)');
            if (!res2.json.cached) outputLines.push('FAIL: Second request was NOT cached');
            if (res1.json.cache_key !== res2.json.cache_key) outputLines.push('FAIL: Cache keys mismatch');
        } else {
            console.log('Smoke Test PASSED');
        }

        fs.writeFileSync(OUTPUT_FILE, outputLines.join('\n'));
        console.log(`Evidence written to ${OUTPUT_FILE}`);

    } catch (e) {
        console.error('Smoke Test Error:', e);
        process.exit(1);
    }
}

run();
