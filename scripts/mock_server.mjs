import http from 'http';
import { URL } from 'url';

const PORT = 53122;
const scanCache = new Map();
const runs = [];
const opportunities = [];

const server = http.createServer((req, res) => {
    // Handle error if URL parsing fails
    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    } catch (e) {
        console.error('URL parse error:', e);
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }
    
    const pathname = parsedUrl.pathname;
    
    console.log(`${req.method} ${pathname}`);

    // Helper to send JSON
    const sendJson = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };

    // Helper to read body
    const readBody = () => new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => resolve(body ? JSON.parse(body) : {}));
    });

    if (req.method === 'GET') {
        if (pathname === '/' || pathname === '/pairs') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`Mock Server ${pathname} OK`);
            return;
        }

        if (pathname === '/opportunities/top') {
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '10');
            const runId = parsedUrl.searchParams.get('run_id');
            
            let filtered = opportunities;
            if (runId) {
                filtered = filtered.filter(o => o.build_run_id === runId || (o.refs && o.refs.run_id === runId));
            }
            
            filtered.sort((a, b) => b.score - a.score);
            sendJson(filtered.slice(0, limit));
            return;
        }

        if (pathname === '/opportunities/runs') {
            sendJson(runs);
            return;
        }

        if (pathname === '/opportunities/by_run') {
            const runId = parsedUrl.searchParams.get('run_id');
            const filtered = opportunities.filter(o => o.build_run_id === runId || (o.refs && o.refs.run_id === runId));
            sendJson(filtered);
            return;
        }
    }

    if (req.method === 'POST') {
        if (pathname === '/scans/run') {
            readBody().then(body => {
                const key = JSON.stringify(body);
                const cached = scanCache.has(key);
                if (!cached) scanCache.set(key, true);
                
                sendJson({
                    cached: cached,
                    cache_key: crypto.createHash('md5').update(key).digest('hex') // Simulate hash
                });
            });
            return;
        }

        if (pathname === '/news/pull') {
            readBody().then(body => {
                // Normalize params for cache key simulation
                const params = {
                    provider: body.provider || 'gdelt',
                    topic_key: body.topic_key || 'GOLD',
                    query: body.query || '',
                    timespan: body.timespan || '1d',
                    maxrecords: body.maxrecords || 50
                };
                const key = JSON.stringify(params);
                const cached = scanCache.has(key);
                
                if (!cached) scanCache.set(key, true);
                
                sendJson({
                    provider_used: params.provider,
                    fallback: false,
                    cached: cached,
                    cache_key: crypto.createHash('sha256').update(key).digest('hex'),
                    data: [] // Mock data
                });
            });
            return;
        }

        if (pathname === '/scans/run_batch') {
            readBody().then(body => {
                const results = body.jobs.map((job, idx) => {
                    const isFail = job.topic_key === 'FAIL_TEST' || job.symbol === 'FAIL_TEST';
                    return {
                        job_id: idx,
                        ok: !isFail,
                        error: isFail ? 'Mock Error' : null
                    };
                });
                
                sendJson({
                    run_id: `mock_batch_${Date.now()}`,
                    concurrency_used: body.concurrency || 1,
                    results: results
                });
            });
            return;
        }

        if (pathname === '/opportunities/build_v1') {
            readBody().then(body => {
                const runId = `mock_build_${Date.now()}`;
                let okCount = 0;
                let failCount = 0;
                
                body.jobs.forEach(job => {
                    const isFail = job.topic_key === 'FAIL_TEST' || job.symbol === 'FAIL_TEST';
                    if (isFail) {
                        failCount++;
                    } else {
                        okCount++;
                        // Generate mock opportunities
                        const n = job.n_opps || 1;
                        for (let i = 0; i < n; i++) {
                            opportunities.push({
                                topic_key: job.symbol || job.topic_key || 'MOCK',
                                score: Math.floor(Math.random() * 100),
                                refs: { 
                                    run_id: runId,
                                    provider_used: 'mock_provider',
                                    cached: false
                                },
                                build_run_id: runId
                            });
                        }
                    }
                });
                
                runs.push({ run_id: runId, timestamp: Date.now() });
                
                sendJson({
                    run_id: runId,
                    jobs_ok: okCount,
                    jobs_failed: failCount
                });
            });
            return;
        }
    }

    res.writeHead(404);
    res.end('Not Found');
});

import crypto from 'crypto';

server.listen(PORT, () => {
    console.log(`Mock server running on port ${PORT}`);
});
