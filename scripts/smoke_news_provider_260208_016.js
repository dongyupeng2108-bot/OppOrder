
import fs from 'fs';
import path from 'path';
import http from 'http';

const DATA_DIR = path.join(process.cwd(), 'data', 'runtime');
const NEWS_FEED_FILE = path.join(DATA_DIR, 'news_feed.jsonl');
const MOCK_PORT = 53122;

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Prepare sample news feed
console.log('--- 1. Preparing sample news feed ---');
const sampleNews = [
    { source: 'TestFeed', published_at: new Date().toISOString(), title: 'Topic A News 1', snippet: 'Details about A1', url: 'http://test/a1', topic_key: 'topic_a' },
    { source: 'TestFeed', published_at: new Date().toISOString(), title: 'Topic A News 2', snippet: 'Details about A2', url: 'http://test/a2', topic_key: 'topic_a' },
    { source: 'TestFeed', published_at: new Date().toISOString(), title: 'Topic B News 1', snippet: 'Details about B1', url: 'http://test/b1', topic_key: 'topic_b' }
];

const fileContent = sampleNews.map(n => JSON.stringify(n)).join('\n');
fs.writeFileSync(NEWS_FEED_FILE, fileContent, 'utf8');
console.log(`Written ${sampleNews.length} lines to ${NEWS_FEED_FILE}`);

// Helper for HTTP requests
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: MOCK_PORT,
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
                    const parsed = data ? JSON.parse(data) : null;
                    resolve({ statusCode: res.statusCode, data: parsed, raw: data });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: null, raw: data });
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

async function runTest() {
    try {
        // 2. Call /news/pull for topic_a
        console.log('\n--- 2. Calling POST /news/pull (topic_a) ---');
        const pullRes = await request('POST', '/news/pull', { topic_key: 'topic_a', limit: 10 });
        console.log('Status:', pullRes.statusCode);
        console.log('Body:', pullRes.data);
        
        if (pullRes.statusCode !== 200 || pullRes.data.fetched === 0) {
            throw new Error('Failed to pull news or no news fetched');
        }

        // 3. Verify /timeline/topic
        console.log('\n--- 3. Verifying GET /timeline/topic (topic_a) ---');
        const timelineRes = await request('GET', '/timeline/topic?topic_key=topic_a');
        console.log('Status:', timelineRes.statusCode);
        
        const newsEntries = timelineRes.data.filter(item => item.type === 'news');
        console.log(`Found ${newsEntries.length} news entries in timeline`);
        
        if (newsEntries.length === 0) {
            throw new Error('No news entries found in timeline');
        }
        console.log('First news entry:', newsEntries[0]);

        // 4. Verify /export/timeline.jsonl
        console.log('\n--- 4. Verifying GET /export/timeline.jsonl (topic_a) ---');
        const exportRes = await request('GET', '/export/timeline.jsonl?topic_key=topic_a');
        console.log('Status:', exportRes.statusCode);
        
        // Split JSONL
        const exportLines = exportRes.raw.trim().split('\n').filter(l => l);
        const newsRows = exportLines.map(l => JSON.parse(l)).filter(r => r.row_type === 'news');
        
        console.log(`Found ${newsRows.length} news rows in export`);
        if (newsRows.length === 0) {
            throw new Error('No news rows found in export');
        }
        console.log('First news row:', newsRows[0]);

        console.log('\nSUCCESS: All smoke tests passed.');

    } catch (e) {
        console.error('\nFAILURE:', e.message);
        process.exit(1);
    }
}

// Wait a bit for server to be ready if needed, or just run
setTimeout(runTest, 1000);
