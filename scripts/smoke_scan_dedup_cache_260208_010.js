
import http from 'http';

function post(path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 53122,
            path: path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log("=== Smoke Test: Dedup & Cache ===");

    // 1. Run Baseline Scan (Scan A)
    console.log("\n1. Running Baseline Scan A...");
    const scanA = await post('/scans/run', {
        seed: 123,
        n_opps: 3,
        topic_key: 'smoke_test',
        dedup_window_sec: 0
    });
    console.log("Scan A:", scanA.scan.scan_id);
    console.log("Scan A Duration:", scanA.scan.duration_ms, "ms");

    // 2. Run Dedup Scan (Scan B) - Should be skipped
    console.log("\n2. Running Dedup Scan B (Window 60s)...");
    const scanB = await post('/scans/run', {
        seed: 124, // Different seed, but same topic_key
        n_opps: 3,
        topic_key: 'smoke_test',
        dedup_window_sec: 60,
        dedup_mode: 'skip'
    });
    
    if (scanB.status === 'skipped') {
        console.log("SUCCESS: Scan B skipped as expected.");
        console.log("Dedup Skipped Count:", scanB.metrics.dedup_skipped_count);
    } else {
        console.error("FAILURE: Scan B was NOT skipped.", scanB);
    }

    // Use a unique topic key to ensure cold cache test works
    const uniqueSuffix = Date.now().toString();
    const topicKey = 'cache_test_' + uniqueSuffix;

    // 3. Run Cache Scan C (Cold)
    console.log("\n3. Run Cache Scan C (Cold)...");
    const scanC = await post('/scans/run', {
        seed: 555,
        n_opps: 2,
        topic_key: topicKey,
        cache_ttl_sec: 900
    });

    console.log("Scan C:", scanC.scan.scan_id);
    console.log("Scan C Cache Misses:", scanC.metrics.cache_miss_count);
    console.log("Scan C Cache Hits:", scanC.metrics.cache_hit_count);
    
    if (scanC.metrics.cache_miss_count > 0 && scanC.metrics.cache_hit_count === 0) {
        console.log("SUCCESS: Scan C cold run (misses > 0, hits = 0).");
    } else {
        console.error("WARNING: Scan C metrics unexpected.", scanC.metrics);
    }

    // 4. Run Cache Scan D (Warm) - Same parameters, should hit cache
    console.log("\n4. Run Cache Scan D (Warm)...");
    const scanD = await post('/scans/run', {
        seed: 555,
        n_opps: 2,
        topic_key: topicKey, // Same key
        cache_ttl_sec: 900
    });
    console.log("Scan D:", scanD.scan.scan_id);
    console.log("Scan D Cache Misses:", scanD.metrics.cache_miss_count);
    console.log("Scan D Cache Hits:", scanD.metrics.cache_hit_count);

    if (scanD.metrics.cache_hit_count > 0 && scanD.metrics.cache_miss_count === 0) {
        console.log("SUCCESS: Scan D warm run (hits > 0, misses = 0).");
    } else {
        console.error("FAILURE: Scan D did not hit cache.", scanD.metrics);
    }
}

run().catch(console.error);
