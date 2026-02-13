import http from 'http';

const PORT = 53122;
const HOST = 'localhost';

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: HOST,
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
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runTests() {
    console.log('Starting News Pagination Tests...');
    let fails = 0;

    // 1. Healthcheck
    try {
        const res = await request('/pairs');
        if (res.status === 200) console.log('[PASS] Healthcheck /pairs 200');
        else { console.error(`[FAIL] Healthcheck /pairs ${res.status}`); fails++; }
    } catch (e) {
        console.error(`[FAIL] Healthcheck conn error: ${e.message}`);
        fails++;
    }

    // 2. Pull Limit 2 (Get Reference)
    let newestId = null;
    let oldestId = null;
    try {
        const res = await request('/news/pull', 'POST', {
            topic_key: 'test_pagination',
            limit: 2
        });
        if (res.status === 200 && res.body.status === 'ok') {
            console.log(`[PASS] Pull Limit 2 OK. Fetched: ${res.body.fetched_count}`);
            if (res.body.items && res.body.items.length > 0) {
                // Assuming DESC sort (Newest First)
                newestId = res.body.items[0].id;
                oldestId = res.body.items[res.body.items.length - 1].id;
                console.log(`[INFO] Newest ID: ${newestId}`);
                console.log(`[INFO] Oldest ID: ${oldestId}`);
                console.log(`[INFO] Latest News ID (Server): ${res.body.latest_news_id}`);
            } else {
                console.warn('[WARN] No items returned, cannot test pagination fully.');
            }
        } else {
            console.error(`[FAIL] Pull Limit 2 Failed: ${JSON.stringify(res.body)}`);
            fails++;
        }
    } catch (e) {
        console.error(`[FAIL] Pull Limit 2 error: ${e.message}`);
        fails++;
    }

    // 3. Pagination Test (since_id)
    if (oldestId) {
        // Test: Ask for news since oldestId. Should return items newer than oldestId.
        // If we got [A, B] (A > B). oldestId = B.
        // since_id = B.
        // Should return [A].
        console.log(`[TEST] Pagination: since_id=${oldestId}`);
        try {
            const res = await request('/news/pull', 'POST', {
                topic_key: 'test_pagination',
                limit: 5,
                since_id: oldestId
            });
            
            if (res.status === 200 && res.body.status === 'ok') {
                const items = res.body.items || [];
                console.log(`[INFO] Fetched ${items.length} items since ${oldestId}`);
                
                // Verify items are newer than oldestId
                const minTs = parseInt(oldestId.split('_')[0]);
                const allNewer = items.every(i => {
                    const ts = parseInt(i.id.split('_')[0]);
                    return ts > minTs;
                });

                if (allNewer) console.log('[PASS] All items are newer than since_id');
                else { console.error('[FAIL] Some items are NOT newer than since_id'); fails++; }
                
                // If original call returned [A, B]. A > B.
                // since_id=B should return [A].
                // Check if A is in the list
                const foundA = items.find(i => i.id === newestId);
                if (foundA) console.log('[PASS] Found newest item in paginated result');
                else console.warn('[WARN] Newest item not found (maybe limit reached or gap?)');

            } else {
                console.error(`[FAIL] Pagination Request Failed: ${JSON.stringify(res.body)}`);
                fails++;
            }
        } catch (e) {
            console.error(`[FAIL] Pagination Test error: ${e.message}`);
            fails++;
        }
    }

    // 4. Limit Clamp Test (Max 50 for GDELT, but local is soft)
    // We'll test GDELT clamp logic via mock params
    try {
        const res = await request('/news/pull', 'POST', {
            topic_key: 'test_clamp',
            provider: 'gdelt',
            maxrecords: 60
        });
        if (res.status === 400 && res.body.code === 'MAXRECORDS_LIMIT') {
            console.log('[PASS] GDELT Limit Clamp 60 -> 400 OK');
        } else {
            console.error(`[FAIL] GDELT Limit Clamp failed: status=${res.status}`);
            fails++;
        }
    } catch (e) {
        console.error(`[FAIL] Clamp Test error: ${e.message}`);
        fails++;
    }

    if (fails > 0) {
        console.error(`Tests Failed: ${fails}`);
        process.exit(1);
    } else {
        console.log('All Tests Passed');
        process.exit(0);
    }
}

runTests();
