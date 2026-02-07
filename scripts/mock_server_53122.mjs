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
const RUNTIME_DIR = path.join(__dirname, '../data/runtime');
const RUNTIME_STORE = path.join(RUNTIME_DIR, 'store.json');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
};

// In-memory state
let inMemoryScans = [];
let inMemoryOpps = [];
let runtimeData = { scans: [], opportunities: [] };
let fixtureStrategies = [];
let fixtureSnapshots = [];

// Initialize state
try {
    // Load Fixtures
    if (fs.existsSync(path.join(FIXTURES_DIR, 'scans.json'))) {
        inMemoryScans = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scans.json'), 'utf8'));
    }
    if (fs.existsSync(path.join(FIXTURES_DIR, 'opportunities.json'))) {
        inMemoryOpps = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'opportunities.json'), 'utf8'));
    }
    if (fs.existsSync(path.join(FIXTURES_DIR, 'strategies.json'))) {
        fixtureStrategies = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'strategies.json'), 'utf8'));
    }
    if (fs.existsSync(path.join(FIXTURES_DIR, 'snapshots.json'))) {
        fixtureSnapshots = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'snapshots.json'), 'utf8'));
    }

    // Load Runtime
    if (fs.existsSync(RUNTIME_STORE)) {
        try {
            const raw = fs.readFileSync(RUNTIME_STORE, 'utf8');
            const data = JSON.parse(raw);
            if (data.scans) runtimeData.scans = data.scans;
            if (data.opportunities) runtimeData.opportunities = data.opportunities;
            
            // Merge
            inMemoryScans = [...inMemoryScans, ...runtimeData.scans];
            inMemoryOpps = [...inMemoryOpps, ...runtimeData.opportunities];
            console.log(`Loaded ${runtimeData.scans.length} scans and ${runtimeData.opportunities.length} opps from runtime store.`);
        } catch (err) {
            console.error("Failed to load runtime store:", err);
        }
    }
} catch (e) {
    console.error("Failed to initialize data:", e);
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
            const { mutate, seed, n_opps, mode } = parsedUrl.query; // Also check body if needed, but query is easier for now as per spec "query 或 body 均可"
            
            // 1. Setup Metrics & Context
            const t0 = Date.now();
            const steps = [];
            const stepStart = (name) => {
                const start = Date.now();
                return { name, start };
            };
            const stepEnd = (ctx, ok = true, note = '') => {
                const duration_ms = Date.now() - ctx.start;
                steps.push({ name: ctx.name, duration_ms, ok, note });
            };

            // 2. Initialize Random
            const sLoad = stepStart('load_context');
            const useSeed = seed ? parseInt(seed, 10) : Date.now();
            const limitOpps = n_opps ? parseInt(n_opps, 10) : 20; // Default max 20
            const isDebug = mode === 'debug';

            // Simple LCG
            class SeededRandom {
                constructor(s) { this.m = 2147483648; this.a = 1103515245; this.c = 12345; this.state = s % this.m; }
                next() { this.state = (this.a * this.state + this.c) % this.m; return this.state / this.m; }
            }
            const rng = new SeededRandom(useSeed);
            
            // Determine previous scan (simulated context loading)
            const lastScan = inMemoryScans.length > 0 ? inMemoryScans[inMemoryScans.length - 1] : null;
            const fromScanId = lastScan ? lastScan.scan_id : null;
            stepEnd(sLoad);

            // 3. Generate Opportunities
            const sGen = stepStart('generate_opps');
            const timestamp = Date.now();
            // Use seeded random for ID generation to ensure reproducibility if seed is provided
            // We combine seed + index to make IDs deterministic
            const scanId = 'sc_' + crypto.createHash('sha256').update(useSeed.toString() + timestamp.toString()).digest('hex').substring(0, 8);

            const newOpps = [];
            
            let numOpps;
            if (n_opps) {
                numOpps = parseInt(n_opps, 10);
            } else {
                numOpps = Math.floor(rng.next() * 5) + 1; 
            }
            if (numOpps > 20) numOpps = 20; // Hard limit

            let yesCount = 0;
            let noCount = 0;
            let unknownCount = 0;

            if (fixtureStrategies.length > 0 && fixtureSnapshots.length > 0) {
                for (let i = 0; i < numOpps; i++) {
                    const strat = fixtureStrategies[Math.floor(rng.next() * fixtureStrategies.length)];
                    const snap = fixtureSnapshots[Math.floor(rng.next() * fixtureSnapshots.length)];
                    // Deterministic ID based on seed and index
                    const oppId = 'op_' + crypto.createHash('sha256').update(useSeed.toString() + i.toString()).digest('hex').substring(0, 8);
                    
                    const isTradeable = rng.next() > 0.5;
                    const tradeableState = isTradeable ? 'TRADEABLE' : 'NOT_TRADEABLE'; // Simplified
                    // For summary stats
                    if (tradeableState === 'TRADEABLE') yesCount++;
                    else if (tradeableState === 'NOT_TRADEABLE') noCount++;
                    else unknownCount++;

                    newOpps.push({
                        opp_id: oppId,
                        strategy_id: strat.strategy_id,
                        snapshot_id: snap.snapshot_id,
                        score: (rng.next() * 100).toFixed(2),
                        tradeable_state: tradeableState,
                        tradeable_reason: 'Generated by RunScan (Seed: ' + useSeed + ')',
                        created_at: new Date().toISOString()
                    });
                }
            }
            stepEnd(sGen, true, `Generated ${newOpps.length} opps`);

            // 4. Construct Scan Object
            const newOppIds = newOpps.map(o => o.opp_id);
            const totalDuration = Date.now() - t0;
            
            const summary = {
                opp_count: newOpps.length,
                tradeable_yes_count: yesCount,
                tradeable_no_count: noCount,
                tradeable_unknown_count: unknownCount
            };

            const newScan = {
                scan_id: scanId,
                timestamp: new Date().toISOString(),
                duration_ms: totalDuration, 
                opp_ids: newOppIds,
                seed: useSeed,
                steps: steps, 
                summary: summary
            };

            // 5. Update Memory & Persist
            const sPersist = stepStart('persist_store');
            
            inMemoryScans.push(newScan);
            inMemoryOpps.push(...newOpps);
            
            runtimeData.scans.push(newScan);
            runtimeData.opportunities.push(...newOpps);
            
            try {
                if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
                const tempFile = path.join(RUNTIME_DIR, 'store.json.tmp');
                fs.writeFileSync(tempFile, JSON.stringify(runtimeData, null, 2));
                if (fs.existsSync(RUNTIME_STORE)) fs.unlinkSync(RUNTIME_STORE);
                fs.renameSync(tempFile, RUNTIME_STORE);
            } catch (persistErr) {
                console.error("Failed to persist runtime store:", persistErr);
                stepEnd(sPersist, false, persistErr.message);
                throw persistErr;
            }
            stepEnd(sPersist);

            // Update total duration in the object (in memory)
            newScan.duration_ms = Date.now() - t0;
            
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
            res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
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

    // 3.1 Export Routes (JSON)
    if (pathname === '/export/replay.json') {
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

            res.setHeader('Content-Disposition', `attachment; filename="replay_${scan}.json"`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
            return;
        }
    }

    if (pathname === '/export/diff.json') {
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

            for (const oppId of commonOppIds) {
                const opp = opportunities.find(o => o.opp_id === oppId);
                if (!opp) continue;
            }

            const result = {
                from_scan_id: from_scan,
                to_scan_id: to_scan,
                added_opp_ids: addedOppIds,
                removed_opp_ids: removedOppIds,
                changed: changed
            };

            res.setHeader('Content-Disposition', `attachment; filename="diff_${from_scan}_${to_scan}.json"`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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

    // GET /opportunities (Custom to use in-memory)
    if (pathname === '/opportunities' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(inMemoryOpps));
        return;
    }

    // 4. API Routes (Fixtures)
    const fixtureMap = {
        '/strategies': 'strategies.json',
        '/snapshots': 'snapshots.json',
        // '/opportunities': 'opportunities.json', // Handled by in-memory route
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
