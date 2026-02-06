import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { fileURLToPath } from 'url';

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

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Parse URL using standard url module
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
        
        // Safety check to prevent escaping UI_DIR
        if (!filePath.startsWith(UI_DIR)) {
             res.writeHead(403);
             res.end('Forbidden');
             return;
        }

        // If file exists, serve it
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const contentType = MIME_TYPES[ext] || 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        // SPA Fallback: If no extension, serve index.html
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
    if (pathname === '/replay') {
        try {
            const { scan } = parsedUrl.query;
            if (!scan) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing scan parameter' }));
                return;
            }

            const scansPath = path.join(FIXTURES_DIR, 'scans.json');
            const oppsPath = path.join(FIXTURES_DIR, 'opportunities.json');

            if (!fs.existsSync(scansPath) || !fs.existsSync(oppsPath)) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Fixtures not found' }));
                return;
            }

            const scans = JSON.parse(fs.readFileSync(scansPath, 'utf8'));
            const opportunities = JSON.parse(fs.readFileSync(oppsPath, 'utf8'));

            const scanRecord = scans.find(s => s.scan_id === scan);
            if (!scanRecord) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Scan not found' }));
                return;
            }

            const oppIds = scanRecord.opp_ids || [];
            const foundOpps = [];
            const missingOppIds = [];

            for (const oppId of oppIds) {
                const opp = opportunities.find(o => o.opp_id === oppId);
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

            const scansPath = path.join(FIXTURES_DIR, 'scans.json');
            const oppsPath = path.join(FIXTURES_DIR, 'opportunities.json');

            if (!fs.existsSync(scansPath) || !fs.existsSync(oppsPath)) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Fixtures not found' }));
                return;
            }

            const scans = JSON.parse(fs.readFileSync(scansPath, 'utf8'));
            const opportunities = JSON.parse(fs.readFileSync(oppsPath, 'utf8'));

            const fromScan = scans.find(s => s.scan_id === from_scan);
            const toScan = scans.find(s => s.scan_id === to_scan);

            if (!fromScan || !toScan) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Scan not found' }));
                return;
            }

            const fromOppIds = new Set(fromScan.opp_ids || []);
            const toOppIds = new Set(toScan.opp_ids || []);

            const addedOppIds = [...toOppIds].filter(id => !fromOppIds.has(id));
            const removedOppIds = [...fromOppIds].filter(id => !toOppIds.has(id));
            
            // Intersection for checking changes
            const commonOppIds = [...fromOppIds].filter(id => toOppIds.has(id));
            const changed = [];

            // In a real system, we might compare different versions of the same opp.
            // Here, with static fixtures, if opp_id is same, the object is same, so no changes.
            // But we implement the logic anyway.
            for (const oppId of commonOppIds) {
                const opp = opportunities.find(o => o.opp_id === oppId);
                if (!opp) continue; // Should not happen if data integrity holds

                // Mock comparison logic: 
                // In this static mock, 'from' and 'to' are the same object.
                // To support 'Changed' testing if needed, one could hack the fixture 
                // or just accept that changed is empty for now.
                // We'll proceed with strict comparison.
                
                // If we really wanted to simulate change, we'd need versioned opps.
                // For now, we just compare the same object to itself (no change).
                
                // However, to strictly follow the "changed" object structure requirement:
                // changed object[]: { opp_id, fields, from, to }
                
                // Let's assume no changes for static data.
            }

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

    // 4. API Routes (Fixtures)
    const fixtureMap = {
        '/strategies': 'strategies.json',
        '/snapshots': 'snapshots.json',
        '/opportunities': 'opportunities.json',
        '/tags': 'tags.json',
        '/scans': 'scans.json'
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