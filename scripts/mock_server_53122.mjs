import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const UI_DIR = path.join(__dirname, '../ui');
const FIXTURES_DIR = path.join(__dirname, '../data/fixtures');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
};

// In-memory state
let inMemoryScans = [];
let inMemoryOpps = [];

// Initialize state
try {
    if (fs.existsSync(path.join(FIXTURES_DIR, 'scans.json'))) {
        inMemoryScans = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scans.json'), 'utf8'));
    }
    if (fs.existsSync(path.join(FIXTURES_DIR, 'opportunities.json'))) {
        inMemoryOpps = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'opportunities.json'), 'utf8'));
    }
} catch (e) {
    console.error("Failed to initialize fixtures:", e);
}

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 1. Root & Pairs (Healthcheck)
    if (pathname === '/' || pathname === '/pairs') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    // 2. UI Routes (Static + SPA Fallback)
    if (pathname.startsWith('/ui')) {
        let relativePath = pathname.replace(/^\/ui/, '');
        if (relativePath === '' || relativePath === '/') relativePath = '/index.html';
        
        let filePath = path.join(UI_DIR, relativePath);
        
        if (!filePath.startsWith(UI_DIR)) {
             res.writeHead(403);
             res.end('Forbidden');
             return;
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const contentType = MIME_TYPES[ext] || 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        if (!path.extname(pathname)) {
             const indexPath = path.join(UI_DIR, 'index.html');
             if (fs.existsSync(indexPath)) {
                 res.writeHead(200, { 'Content-Type': 'text/html' });
                 fs.createReadStream(indexPath).pipe(res);
                 return;
             }
        }
        
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found (UI)');
        return;
    }

    // 3. API Routes (Custom Logic)

    // POST /scans/run
    if (pathname === '/scans/run' && req.method === 'POST') {
        try {
            const { mutate } = parsedUrl.query;
            const shouldMutate = mutate === '1';

            const timestamp = Date.now();
            const scanId = 'sc_' + crypto.createHash('sha256').update(timestamp.toString()).digest('hex').substring(0, 8);

            // Determine previous scan
            const lastScan = inMemoryScans.length > 0 ? inMemoryScans[inMemoryScans.length - 1] : null;
            const fromScanId = lastScan ? lastScan.scan_id : null;

            // Pick opp_ids
            let newOppIds = [];
            const allOppIds = inMemoryOpps.map(o => o.opp_id);

            if (lastScan) {
                newOppIds = [...(lastScan.opp_ids || [])];
            } else {
                 newOppIds = allOppIds.slice(0, 5); 
            }

            // Mutation logic
            if (shouldMutate && allOppIds.length > 0) {
                 // Simple mutation: remove one or add one
                 if (Math.random() > 0.5 && newOppIds.length > 0) {
                     // Remove
                     newOppIds.pop();
                 } else {
                     // Add
                     const candidates = allOppIds.filter(id => !newOppIds.includes(id));
                     if (candidates.length > 0) {
                         newOppIds.push(candidates[0]);
                     } else if (newOppIds.length > 0) {
                         // Fallback to remove if we can't add unique
                         newOppIds.pop();
                     }
                 }
            }

            const newScan = {
                scan_id: scanId,
                timestamp: new Date().toISOString(),
                duration_ms: Math.floor(Math.random() * 1000) + 100,
                opp_ids: newOppIds
            };

            inMemoryScans.push(newScan);

            const result = {
                scan: newScan,
                from_scan_id: fromScanId,
                to_scan_id: scanId
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
        }
    }

    // GET /scans (Custom to use in-memory)
    if (pathname === '/scans' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(inMemoryScans));
        return;
    }

    if (pathname === '/replay') {
        try {
            const { scan } = parsedUrl.query;
            if (!scan) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing scan parameter' }));
                return;
            }

            const scanRecord = inMemoryScans.find(s => s.scan_id === scan);
            if (!scanRecord) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Scan not found' }));
                return;
            }

            const oppIds = scanRecord.opp_ids || [];
            const foundOpps = [];
            const missingOppIds = [];

            for (const oppId of oppIds) {
                const opp = inMemoryOpps.find(o => o.opp_id === oppId);
                if (opp) {
                    foundOpps.push(opp);
                } else {
                    missingOppIds.push(oppId);
                }
            }

            const result = {
                scan: scanRecord,
                opportunities: foundOpps,
                missing_opp_ids: missingOppIds
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
        }
    }

    if (pathname === '/diff') {
        try {
            const { from_scan, to_scan } = parsedUrl.query;
            if (!from_scan || !to_scan) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing from_scan or to_scan parameters' }));
                return;
            }

            const fromScan = inMemoryScans.find(s => s.scan_id === from_scan);
            const toScan = inMemoryScans.find(s => s.scan_id === to_scan);

            if (!fromScan || !toScan) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Scan not found' }));
                return;
            }

            const fromOppIds = new Set(fromScan.opp_ids || []);
            const toOppIds = new Set(toScan.opp_ids || []);

            const addedOppIds = [...toOppIds].filter(id => !fromOppIds.has(id));
            const removedOppIds = [...fromOppIds].filter(id => !toOppIds.has(id));
            const changed = [];

            const result = {
                from_scan_id: from_scan,
                to_scan_id: to_scan,
                added_opp_ids: addedOppIds,
                removed_opp_ids: removedOppIds,
                changed: changed
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
        }
    }

    // 3.1 Export Routes
    if (pathname === '/export/replay.csv') {
        try {
            const { scan } = parsedUrl.query;
            if (!scan) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Missing scan parameter');
                return;
            }

            const scanRecord = inMemoryScans.find(s => s.scan_id === scan);
            if (!scanRecord) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Scan not found');
                return;
            }

            const oppIds = scanRecord.opp_ids || [];
            const foundOpps = [];
            
            for (const oppId of oppIds) {
                const opp = inMemoryOpps.find(o => o.opp_id === oppId);
                if (opp) {
                    foundOpps.push(opp);
                }
            }

            const header = 'opp_id,strategy_id,snapshot_id,score,tradeable_state,tradeable_reason,created_at';
            const rows = foundOpps.map(o => {
                return [
                    o.opp_id,
                    o.strategy_id,
                    o.snapshot_id,
                    o.score,
                    o.tradeable_state,
                    (o.tradeable_reason && o.tradeable_reason.includes(',')) ? `"${o.tradeable_reason}"` : (o.tradeable_reason || ''),
                    o.created_at
                ].join(',');
            });

            const csv = [header, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="replay_${scan}.csv"`);
            res.writeHead(200);
            res.end(csv);
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
            return;
        }
    }

    if (pathname === '/export/diff.csv') {
        try {
            const { from_scan, to_scan } = parsedUrl.query;
            if (!from_scan || !to_scan) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Missing from_scan or to_scan parameters');
                return;
            }

            const fromScan = inMemoryScans.find(s => s.scan_id === from_scan);
            const toScan = inMemoryScans.find(s => s.scan_id === to_scan);

            if (!fromScan || !toScan) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Scan not found');
                return;
            }

            const fromOppIds = new Set(fromScan.opp_ids || []);
            const toOppIds = new Set(toScan.opp_ids || []);

            const addedOppIds = [...toOppIds].filter(id => !fromOppIds.has(id));
            const removedOppIds = [...fromOppIds].filter(id => !toOppIds.has(id));
            
            const rows = [];
            
            addedOppIds.forEach(id => {
                rows.push(`added,${id},,,`);
            });
            
            removedOppIds.forEach(id => {
                rows.push(`removed,${id},,,`);
            });
            
            const header = 'type,opp_id,field,from,to';
            const csv = [header, ...rows].join('\n');

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="diff_${from_scan}_${to_scan}.csv"`);
            res.writeHead(200);
            res.end(csv);
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
            return;
        }
    }

    // 4. API Routes (Fixtures)
    const fixtureMap = {
        '/strategies': 'strategies.json',
        '/snapshots': 'snapshots.json',
        '/opportunities': 'opportunities.json',
        '/tags': 'tags.json'
        // '/scans': 'scans.json' // Handled by in-memory route
    };

    if (fixtureMap[pathname]) {
        const filePath = path.join(FIXTURES_DIR, fixtureMap[pathname]);
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Fixture not found: ${fixtureMap[pathname]}`);
        }
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Mock server running on port ${PORT}`);
});
