import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const OUTPUT_FILE = path.join(__dirname, 'scan_cache_smoke_260215_014.txt');

function runScan(label) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            n_opps: 1,
            mode: 'fast',
            seed: 12345, // Deterministic seed
            timestamp: Date.now() // This should be ignored by the cache key logic
        });

        const options = {
            hostname: 'localhost',
            port: PORT,
            path: '/scans/run',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const start = Date.now();
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const duration = Date.now() - start;
                try {
                    const json = JSON.parse(data);
                    resolve({ label, duration, json, status: res.statusCode });
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

async function main() {
    console.log("Starting Scan Cache Smoke Test...");
    const lines = [];

    try {
        // 1. First Scan (Expect MISS)
        console.log("Running Scan 1 (Expect MISS)...");
        const res1 = await runScan('Scan 1');
        
        lines.push(`Scan 1 (MISS):`);
        lines.push(`  Status: ${res1.status}`);
        lines.push(`  Cached: ${res1.json.cached}`);
        lines.push(`  Cache Key: ${res1.json.cache_key}`);
        lines.push(`  Duration: ${res1.duration}ms`);
        lines.push(`  Scan ID: ${res1.json.scan_id}`);
        lines.push('');

        if (res1.json.cached !== false) {
            console.error("FAIL: Scan 1 should be cached=false");
            lines.push("FAIL: Scan 1 should be cached=false");
        }

        // 2. Second Scan (Expect HIT)
        console.log("Running Scan 2 (Expect HIT)...");
        const res2 = await runScan('Scan 2');

        lines.push(`Scan 2 (HIT):`);
        lines.push(`  Status: ${res2.status}`);
        lines.push(`  Cached: ${res2.json.cached}`);
        lines.push(`  Cache Key: ${res2.json.cache_key}`);
        lines.push(`  Duration: ${res2.duration}ms`);
        lines.push(`  Cached From Scan ID: ${res2.json.cached_from_scan_id}`);
        lines.push('');

        if (res2.json.cached !== true) {
            console.error("FAIL: Scan 2 should be cached=true");
            lines.push("FAIL: Scan 2 should be cached=true");
        }

        // 3. Comparison
        lines.push(`Comparison:`);
        lines.push(`  Scan 1 Duration: ${res1.duration}ms`);
        lines.push(`  Scan 2 Duration: ${res2.duration}ms`);
        
        if (res2.duration < res1.duration) {
             lines.push(`  Result: HIT is faster by ${res1.duration - res2.duration}ms`);
        } else {
             lines.push(`  Result: HIT is NOT faster (Warning)`);
        }
        
        // Key verification
        if (res1.json.cache_key === res2.json.cache_key) {
            lines.push(`  Cache Keys Match: YES`);
        } else {
             lines.push(`  Cache Keys Match: NO (FAIL)`);
        }

        const output = lines.join('\n');
        fs.writeFileSync(OUTPUT_FILE, output);
        console.log(`Evidence written to ${OUTPUT_FILE}`);
        console.log(output);

    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

main();
