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

const server = http.createServer(async (req, res) => {
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
        const bodyPromise = new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        try {
            const rawBody = await bodyPromise;
            let bodyParams = {};
            if (rawBody) {
                try {
                    bodyParams = JSON.parse(rawBody);
                } catch (e) {
                    // ignore invalid json
                }
            }
            
            const params = { ...parsedUrl.query, ...bodyParams };
            let { seed, n_opps, mode, persist, max_n_opps } = params;

            // Defaults
            seed = (seed === undefined || seed === null || seed === '') ? 111 : parseInt(seed, 10);
            let n_opps_raw = (n_opps === undefined || n_opps === null || n_opps === '') ? 5 : parseInt(n_opps, 10);
            mode = (mode === undefined || mode === null || mode === '') ? 'fast' : mode;
            persist = (persist === undefined || persist === null || persist === '') ? true : (String(persist) === 'true');
            max_n_opps = (max_n_opps === undefined || max_n_opps === null || max_n_opps === '') ? 50 : parseInt(max_n_opps, 10);

            // Validation & Cap
            if (isNaN(n_opps_raw) || n_opps_raw < 1) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid n_opps. Must be >= 1.' }));
                return;
            }
            
            const n_opps_actual = Math.min(n_opps_raw, max_n_opps);
            const truncated = n_opps_raw > max_n_opps;

            // 1. Setup Metrics & Context
            const t0 = Date.now();
            const metrics = {
                stage_ms: {},
                persist_enabled: persist,
                truncated: truncated,
                n_opps_requested: n_opps_raw,
                n_opps_actual: n_opps_actual,
                seed: seed,
                mode: mode
            };
            
            const stepStart = (name) => {
                return Date.now();
            };
            const stepEnd = (name, start) => {
                const duration = Date.now() - start;
                metrics.stage_ms[name] = duration;
                return duration;
            };

            // 2. Initialize Random
            // Simple LCG
            class SeededRandom {
                constructor(s) { this.m = 2147483648; this.a = 1103515245; this.c = 12345; this.state = s % this.m; }
                next() { this.state = (this.a * this.state + this.c) % this.m; return this.state / this.m; }
            }
            const rng = new SeededRandom(seed);
            
            // Determine previous scan (simulated context loading)
            const lastScan = inMemoryScans.length > 0 ? inMemoryScans[inMemoryScans.length - 1] : null;
            const fromScanId = lastScan ? lastScan.scan_id : null;

            // 3. Generate Opportunities
            const tGen = stepStart('generate_opps');
            const timestamp = Date.now();
            // Use seeded random for ID generation to ensure reproducibility if seed is provided
            const scanId = 'sc_' + crypto.createHash('sha256').update(seed.toString() + timestamp.toString()).digest('hex').substring(0, 8);

            const newOpps = [];
            let yesCount = 0;
            let noCount = 0;
            let unknownCount = 0;

            if (fixtureStrategies.length > 0 && fixtureSnapshots.length > 0) {
                for (let i = 0; i < n_opps_actual; i++) {
                    // Use RNG to select strategy/snapshot deterministically
                    const stratIndex = Math.floor(rng.next() * fixtureStrategies.length);
                    const snapIndex = Math.floor(rng.next() * fixtureSnapshots.length);
                    
                    const strat = fixtureStrategies[stratIndex];
                    const snap = fixtureSnapshots[snapIndex];
                    
                    // Deterministic ID based on seed and index
                    const oppId = 'op_' + crypto.createHash('sha256').update(seed.toString() + i.toString() + 'v1').digest('hex').substring(0, 8);
                    
                    const isTradeable = rng.next() > 0.5;
                    const tradeableState = isTradeable ? 'TRADEABLE' : 'NOT_TRADEABLE';
                    
                    if (tradeableState === 'TRADEABLE') yesCount++;
                    else if (tradeableState === 'NOT_TRADEABLE') noCount++;
                    else unknownCount++;

                    newOpps.push({
                        opp_id: oppId,
                        strategy_id: strat.strategy_id,
                        snapshot_id: snap.snapshot_id,
                        score: (rng.next() * 100).toFixed(2),
                        tradeable_state: tradeableState,
                        tradeable_reason: `Generated by RunScan (Seed: ${seed}, Mode: ${mode})`,
                        created_at: new Date().toISOString()
                    });
                }
            }
            stepEnd('generate_opps', tGen);

            // 4. Construct Scan Object
            const newOppIds = newOpps.map(o => o.opp_id);
            
            const summary = {
                opp_count: newOpps.length,
                tradeable_yes_count: yesCount,
                tradeable_no_count: noCount,
                tradeable_unknown_count: unknownCount
            };

            const newScan = {
                scan_id: scanId,
                timestamp: new Date().toISOString(),
                duration_ms: 0, // placeholder
                opp_ids: newOppIds,
                seed: seed,
                n_opps: n_opps_actual,
                mode: mode,
                metrics: metrics,
                summary: summary
            };

            // 5. Update Memory & Persist
            inMemoryScans.push(newScan);
            inMemoryOpps.push(...newOpps);

            if (persist) {
                const tPersist = stepStart('persist_store');
                
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
                    throw persistErr;
                }
                stepEnd('persist_store', tPersist);
            } else {
                metrics.stage_ms['persist_store'] = 0;
            }

            // Update total duration
            newScan.duration_ms = Date.now() - t0;
            metrics.total_ms = newScan.duration_ms;
            
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
