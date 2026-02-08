import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT_DIR, 'data', 'runtime');

const BASE_URL = 'http://localhost:53122';
const TOPIC_KEY = 'topic_smoke_news_260208_018';

async function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 53122,
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
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data }); // Fallback for non-json
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function main() {
    console.log('Starting Smoke Test 260208_018...');
    // 1. Setup News Feed
    console.log('1. Setting up news feed...');
    if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const newsFile = path.join(RUNTIME_DIR, 'news_feed.jsonl');
    
    const newsItems = [
        { topic_key: TOPIC_KEY, title: "Smoke News 1", url: "http://test/1", source: "Test", published_at: new Date().toISOString(), snippet: "News 1 content" },
        { topic_key: TOPIC_KEY, title: "Smoke News 2", url: "http://test/2", source: "Test", published_at: new Date().toISOString(), snippet: "News 2 content" },
        { topic_key: TOPIC_KEY, title: "Smoke News 3", url: "http://test/3", source: "Test", published_at: new Date().toISOString(), snippet: "News 3 content" }
    ];
    
    // Append to file
    for (const item of newsItems) {
        fs.appendFileSync(newsFile, JSON.stringify(item) + '\n');
    }
    console.log(`Appended ${newsItems.length} items to ${newsFile}`);

    // 2. Run Scan
    console.log('2. Running Scan...');
    const scanRes = await request('POST', `/scans/run?topic_key=${TOPIC_KEY}&n_opps=3&seed=123&with_news=true`);
    if (scanRes.status !== 200) throw new Error(`Scan failed: ${JSON.stringify(scanRes.data)}`);
    const scanId = scanRes.data.to_scan_id || scanRes.data.scan?.scan_id;
    console.log('Scan OK:', scanId);

    // 3. Pull News
    console.log('3. Pulling News...');
    // Even if scan pulled news, we can pull again to verify idempotency/updates
    const pullRes = await request('POST', '/news/pull', { topic_key: TOPIC_KEY, limit: 10 });
    if (pullRes.status !== 200) throw new Error(`News Pull failed: ${JSON.stringify(pullRes.data)}`);
    console.log('Pull OK:', pullRes.data);
    if (pullRes.data.fetched < 3) console.warn('Warning: Fetched fewer news than expected');

    // 4. Loop Monitor -> Plan until jobs found
    console.log('4. Monitor & Plan loop...');
    let jobs = [];
    for (let i = 0; i < 20; i++) {
        // Tick
        await request('POST', '/monitor/tick', { universe: `scan:${scanId}`, simulate_price_move: true });
        
        // Plan
        const planRes = await request('POST', '/reeval/plan', { universe: `scan:${scanId}` });
        if (planRes.status === 200 && planRes.data.jobs && planRes.data.jobs.length > 0) {
            jobs = planRes.data.jobs;
            console.log(`Found ${jobs.length} jobs after ${i+1} ticks.`);
            break;
        }
        await new Promise(r => setTimeout(r, 100)); // small delay
    }

    if (jobs.length === 0) {
        throw new Error('Failed to trigger reeval jobs after 20 ticks.');
    }

    // 5. Run Reeval
    console.log('5. Running Reeval...');
    const runRes = await request('POST', '/reeval/run', { jobs: jobs });
    if (runRes.status !== 200) throw new Error(`Reeval Run failed: ${JSON.stringify(runRes.data)}`);
    console.log('Reeval Run OK:', runRes.data);

    // 6. Verify Timeline Export
    console.log('6. Verifying Timeline Export...');
    const tlRes = await request('GET', `/export/timeline.jsonl?topic_key=${TOPIC_KEY}`);
    const tlLines = (tlRes.data && typeof tlRes.data === 'string') ? tlRes.data.split('\n').filter(l => l) : [];
    // Note: request helper parses JSON, but export is JSONL (text).
    // If it parsed as JSON (failed), it returned raw string in data property based on my helper.
    // Wait, helper tries JSON.parse. If JSONL, it might fail or parse first line?
    // My helper: "try { const json = JSON.parse(data); ... } catch (e) { resolve({ status, data }); }"
    // So if it's multiple JSON objects (JSONL), JSON.parse will fail, and I get the raw string. Correct.
    
    let newsFound = 0;
    let refsFound = 0;
    
    for (const line of tlLines) {
        try {
            const row = JSON.parse(line);
            if (row.row_type === 'news') newsFound++;
            if ((row.row_type === 'reeval' || row.row_type === 'llm') && row.news_refs) {
                const refs = JSON.parse(row.news_refs);
                if (Array.isArray(refs) && refs.length > 0) refsFound++;
            }
        } catch (e) {}
    }
    
    console.log(`Timeline: News Rows=${newsFound}, Rows with NewsRefs=${refsFound}`);
    if (newsFound === 0) throw new Error('No news rows found in timeline export');
    if (refsFound === 0) throw new Error('No news_refs found in reeval/llm rows');

    // 7. Verify Batch Dataset Export
    console.log('7. Verifying Batch Dataset Export...');
    // We need batch_id? The reeval/run creates reeval_row with batch_id from previous scan row.
    // We can just fetch latest dataset rows.
    const dsRes = await request('GET', '/export/batch_dataset.jsonl?limit=50');
    const dsLines = (dsRes.data && typeof dsRes.data === 'string') ? dsRes.data.split('\n').filter(l => l) : [];
    
    let dsRefsFound = 0;
    for (const line of dsLines) {
        try {
            const row = JSON.parse(line);
            if (row.news_refs && Array.isArray(row.news_refs) && row.news_refs.length > 0) {
                // Check if it belongs to our topic/opps (optional, but good)
                dsRefsFound++;
            }
        } catch (e) {}
    }
    console.log(`Dataset: Rows with NewsRefs=${dsRefsFound}`);
    if (dsRefsFound === 0) throw new Error('No news_refs found in batch dataset export');

    console.log('SUCCESS: All smoke tests passed.');
    
    // Write result
    const reportDir = path.join(ROOT_DIR, 'rules', 'task-reports', '2026-02');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, '260208_018_smoke_result.json'), JSON.stringify({ status: 'PASS', timestamp: new Date().toISOString() }, null, 2));

}

main().catch(e => {
    console.error('FAILED:', e);
    process.exit(1);
});
