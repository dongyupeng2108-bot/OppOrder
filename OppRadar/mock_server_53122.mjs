import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getProvider } from './llm_provider.mjs';
import { getProvider as getNewsProvider } from './news_provider.mjs';
import { generateCacheKey, getFromCache, setInCache } from './news_pull_cache.mjs';
import DB from './db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 53122;
const UI_DIR = path.join(__dirname, '../ui');
const FIXTURES_DIR = path.join(__dirname, '../data/fixtures');
const RUNTIME_DIR = path.join(__dirname, '../data/runtime');
const RUNTIME_STORE = path.join(RUNTIME_DIR, 'store.json');

// Initialize LLM Provider
const llmProvider = getProvider(process.env.LLM_PROVIDER || 'mock');
console.log(`LLM Provider initialized: ${process.env.LLM_PROVIDER || 'mock'}`);

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
};

// In-memory state
let inMemoryBatches = []; // batch_id -> batchResult
let inMemoryScans = [];
let inMemoryOpps = [];
let fixtureStrategies = [];
let fixtureSnapshots = [];
let runtimeData = {
    scans: [],
    opportunities: [],
    monitor_state: {},
    llm_dataset_rows: [],
    llm_cache: {}
};
let monitorState = {};

// Helper: Run Scan Core Logic (Decoupled from HTTP)
async function runScanCore(params) {
    let { seed, n_opps, mode, persist, max_n_opps, llm_provider, topic_key, dedup_window_sec, dedup_mode, cache_ttl_sec, batch_id, with_news } = params;

    // Defaults
    seed = (seed === undefined || seed === null || seed === '') ? 111 : parseInt(seed, 10);
    let n_opps_raw = (n_opps === undefined || n_opps === null || n_opps === '') ? 5 : parseInt(n_opps, 10);
    mode = (mode === undefined || mode === null || mode === '') ? 'fast' : mode;
    persist = (persist === undefined || persist === null || persist === '') ? true : (String(persist) === 'true');
    max_n_opps = (max_n_opps === undefined || max_n_opps === null || max_n_opps === '') ? 50 : parseInt(max_n_opps, 10);
    
    topic_key = topic_key || 'default_topic';
    dedup_window_sec = (dedup_window_sec === undefined || dedup_window_sec === null || dedup_window_sec === '') ? 0 : parseInt(dedup_window_sec, 10);
    dedup_mode = (dedup_mode === undefined || dedup_mode === null || dedup_mode === '') ? 'run' : dedup_mode;
    cache_ttl_sec = (cache_ttl_sec === undefined || cache_ttl_sec === null || cache_ttl_sec === '') ? 900 : parseInt(cache_ttl_sec, 10);
    with_news = (with_news === undefined || with_news === null || with_news === '') ? false : (String(with_news) === 'true');

    // Resolve LLM Provider for this run
    const runLLMProviderName = llm_provider || process.env.LLM_PROVIDER || 'mock';
    const runLLMProvider = getProvider(runLLMProviderName);

    // Validation & Cap
    if (isNaN(n_opps_raw) || n_opps_raw < 1) {
        throw new Error('Invalid n_opps. Must be >= 1.');
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
        mode: mode,
        topic_key: topic_key,
        dedup_skipped_count: 0,
        cache_hit_count: 0,
        cache_miss_count: 0
    };
    
    const stageLogs = [];
    const logStage = (id, start, input = {}, output = {}, warnings = [], errors = []) => {
        const end = Date.now();
        stageLogs.push({
            stage_id: id,
            start_ts: new Date(start).toISOString(),
            end_ts: new Date(end).toISOString(),
            dur_ms: end - start,
            input_summary: input,
            output_summary: output,
            warnings: warnings,
            errors: errors
        });
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

    // 1.1 Dedup Check
    if (dedup_window_sec > 0) {
        const cutoff = Date.now() - (dedup_window_sec * 1000);
        const recentScan = inMemoryScans.slice().reverse().find(s => 
            s.topic_key === topic_key && 
            new Date(s.timestamp).getTime() > cutoff
        );

        if (recentScan) {
            if (dedup_mode === 'skip') {
                metrics.dedup_skipped_count = 1;
                const scan = {
                    scan_id: 'skipped_' + crypto.createHash('sha256').update(seed.toString() + Date.now().toString()).digest('hex').substring(0, 8),
                    timestamp: new Date().toISOString(),
                    duration_ms: Date.now() - t0,
                    n_opps_requested: n_opps_raw,
                    n_opps_actual: 0,
                    status: 'skipped',
                    topic_key: topic_key,
                    metrics: metrics,
                    stage_logs: [{
                        stage_id: 'dedup_check',
                        start_ts: new Date().toISOString(),
                        end_ts: new Date().toISOString(),
                        dur_ms: 0,
                        input_summary: { topic_key, dedup_window_sec },
                        output_summary: { skipped: true, reason: 'dedup_hit', original_scan_id: recentScan.scan_id },
                        warnings: [`Skipped due to dedup (window: ${dedup_window_sec}s)`],
                        errors: []
                    }]
                };
                return { scan, skipped: true };
            }
        }
    }

    // Stage: Load Context
    const tLoad = Date.now();
    // Determine previous scan (simulated context loading)
    const lastScan = inMemoryScans.length > 0 ? inMemoryScans[inMemoryScans.length - 1] : null;
    const fromScanId = lastScan ? lastScan.scan_id : null;
    logStage('load_context', tLoad, {}, { from_scan_id: fromScanId }, [], []);

    // 3. Pipeline Execution
    const tGen = Date.now();
    
    // DB: Ensure topic exists (Fail-soft)
    try {
        await DB.appendTopic(topic_key, { seed, mode, batch_id });

        // News Pull (Optional)
        if (with_news) {
            const tNews = Date.now();
            try {
                const newsProvider = getNewsProvider(process.env.NEWS_PROVIDER || 'local');
                const newsItems = await newsProvider.fetchNews(topic_key, 5);
                let written = 0;
                let deduped = 0;
                for (const item of newsItems) {
                    const content_hash = crypto.createHash('sha256').update(item.title + (item.published_at || '')).digest('hex');
                    const res = await DB.appendNews({
                        topic_key: topic_key,
                        ts: new Date(item.published_at).getTime(),
                        title: item.title,
                        url: item.url,
                        publisher: item.source,
                        summary: item.snippet,
                        credibility: 0.8,
                        raw_json: item,
                        published_at: item.published_at,
                        content_hash: content_hash
                    });
                    if (res.inserted) written++;
                    else deduped++;
                }
                logStage('news_pull', tNews, { topic_key }, { fetched: newsItems.length, written, deduped }, [], []);
            } catch (e) {
                logStage('news_pull', tNews, { topic_key }, {}, [], [e.message]);
            }
        }
    } catch (e) { console.error('DB appendTopic fail:', e); }

    // 3.1 Stage: gen_opps (Candidates)
    const tGenStart = Date.now();
    const timestamp = Date.now();
    const scanId = 'sc_' + crypto.createHash('sha256').update(seed.toString() + timestamp.toString()).digest('hex').substring(0, 8);
    const newOpps = [];
    
    if (fixtureStrategies.length > 0 && fixtureSnapshots.length > 0) {
        for (let i = 0; i < n_opps_actual; i++) {
            const stratIndex = Math.floor(rng.next() * fixtureStrategies.length);
            const snapIndex = Math.floor(rng.next() * fixtureSnapshots.length);
            const strat = fixtureStrategies[stratIndex];
            const snap = fixtureSnapshots[snapIndex];
            const oppId = 'op_' + crypto.createHash('sha256').update(seed.toString() + i.toString() + 'v1').digest('hex').substring(0, 8);
            
            const isTradeable = rng.next() > 0.5;
            const tradeableState = isTradeable ? 'TRADEABLE' : 'NOT_TRADEABLE';

            const oppObj = {
                opp_id: oppId,
                topic_key: topic_key, // Add topic_key for reeval lookup
                strategy_id: strat.strategy_id,
                snapshot_id: snap.snapshot_id,
                tradeable_state: tradeableState,
                tradeable_reason: `Generated by RunScan (Seed: ${seed}, Mode: ${mode})`,
                created_at: new Date().toISOString()
            };
            newOpps.push(oppObj);
        }
    }
    logStage('gen_opps', tGenStart, { n_opps: n_opps_actual, seed }, { generated: newOpps.length }, [], []);

    // 3.2 Stage: score_baseline
    const tScoreStart = Date.now();
    newOpps.forEach(opp => {
        const scoreVal = rng.next() * 100;
        const scoreBaseline = parseFloat(scoreVal.toFixed(2));
        const scoreComponents = {
            spread_edge: parseFloat((rng.next() * 30).toFixed(2)),
            liquidity: parseFloat((rng.next() * 20).toFixed(2)),
            volatility: parseFloat((rng.next() * 20).toFixed(2)),
            risk_reward: parseFloat((rng.next() * 30).toFixed(2))
        };
        opp.score = scoreBaseline;
        opp.score_baseline = scoreBaseline;
        opp.score_components = scoreComponents;
    });
    logStage('score_baseline', tScoreStart, {}, { scored: newOpps.length }, [], []);

    // DB: Append Snapshots (Fail-soft)
    for (const opp of newOpps) {
        try {
            await DB.appendSnapshot({
                id: crypto.randomUUID(),
                topic_key: topic_key,
                option_id: opp.opp_id,
                ts: Date.now(),
                prob: opp.score_baseline,
                market_price: 0, // Mock
                source: 'mock_run',
                raw_json: opp
            });
        } catch (e) { console.error('DB appendSnapshot fail:', e); }
    }

    // 3.3 Stage: llm_analyze
    const tLlmStart = Date.now();
    let errorsCount = 0;
    let analyzedCount = 0;
    let fallbackCount = 0;
    const genWarnings = [];
    
    // Process sequentially for async LLM
    for (const opp of newOpps) {
        try {
            // Cache Key Construction
            const inputContent = JSON.stringify({
                strategy: opp.strategy_id,
                snapshot: opp.snapshot_id,
                score: opp.score_baseline
            });
            const promptHash = crypto.createHash('sha256').update(inputContent).digest('hex').substring(0, 8);
            const timeBucket = Math.floor(Date.now() / (cache_ttl_sec * 1000)); // TTL Bucket
            const cacheKey = `${runLLMProviderName}_${runLLMProvider.model || 'default'}_${promptHash}_${topic_key}_${timeBucket}`;
            
            let llmResult = null;
            if (runtimeData.llm_cache[cacheKey]) {
                llmResult = runtimeData.llm_cache[cacheKey];
                metrics.cache_hit_count++;
            } else {
                llmResult = await runLLMProvider.summarizeOpp(opp);
                metrics.cache_miss_count++;
                // Cache it
                runtimeData.llm_cache[cacheKey] = llmResult;
            }

            opp.llm_provider = llmResult.llm_provider;
            opp.llm_model = llmResult.llm_model;
            opp.llm_summary = llmResult.llm_summary;
            opp.llm_confidence = llmResult.llm_confidence;
            opp.llm_tags = llmResult.llm_tags;
            opp.llm_latency_ms = llmResult.llm_latency_ms;
            opp.llm_error = llmResult.llm_error;
            opp.llm_input_prompt = llmResult.llm_input_prompt; // Capture prompt
            opp.llm_json = llmResult.llm_json;

            // Fetch News Refs
            let newsRefs = [];
            try {
                const recentNews = await DB.getRecentNews(topic_key, 3);
                newsRefs = recentNews.map(n => n.id);
            } catch (e) { console.error('Error fetching news for LLM:', e); }

            // Capture Dataset Row
            const datasetRow = createLLMDatasetRow(opp, { scan_id: scanId, trigger_reason: 'initial', batch_id: batch_id, news_refs: newsRefs });
            runtimeData.llm_dataset_rows.push(datasetRow);

            // DB: Append LLM Row (Fail-soft)
            try {
                await DB.appendLLMRow({
                    id: crypto.randomUUID(),
                    topic_key: topic_key,
                    option_id: opp.opp_id,
                    ts: Date.now(),
                    provider: opp.llm_provider,
                    model: opp.llm_model,
                    prompt_hash: promptHash,
                    llm_json: { summary: opp.llm_summary, confidence: opp.llm_confidence, error: opp.llm_error },
                    tags_json: opp.llm_tags,
                    latency_ms: opp.llm_latency_ms,
                    raw_json: datasetRow,
                    news_refs: newsRefs
                });
            } catch (e) { console.error('DB appendLLMRow fail:', e); }

            analyzedCount++;
            if (llmResult.llm_summary === "OLLAMA_UNAVAILABLE_FALLBACK" || llmResult.llm_tags.includes('fallback_from_openrouter')) {
                fallbackCount++;
                genWarnings.push(`Fallback for ${opp.opp_id}: ${llmResult.llm_error}`);
            }
        } catch (llmErr) {
            console.error(`LLM Provider Error for ${opp.opp_id}:`, llmErr);
            opp.llm_summary = "Error generating summary";
            opp.llm_tags = ['error'];
            opp.llm_error = llmErr.message;
            errorsCount++;
            genWarnings.push(llmErr.message);
        }
    }
    logStage('llm_analyze', tLlmStart, { provider: runLLMProviderName }, { processed: newOpps.length, analyzed_count: analyzedCount, fallback_count: fallbackCount, errors: errorsCount, provider: runLLMProviderName, model: runLLMProvider.model || 'unknown' }, genWarnings, []);

    // 4. Construct Scan Object
    const tConstruct = Date.now();
    
    // Add current logs to scan
    const scan = {
        scan_id: scanId,
        timestamp: new Date(timestamp).toISOString(),
        duration_ms: Date.now() - t0, // approximate so far
        n_opps_requested: n_opps_raw,
        n_opps_actual: n_opps_actual,
        seed: seed,
        mode: mode,
        topic_key: topic_key,
        opp_ids: newOpps.map(o => o.opp_id),
        stage_logs: [...stageLogs], // Copy current logs
        metrics: metrics
    };
    
    inMemoryScans.push(scan);
    // Also push opps to inMemoryOpps
    newOpps.forEach(o => inMemoryOpps.push(o));
    
    // 5. Persist
    const tPersist = Date.now();
    const stepPersist = stepStart('persist_store');
    let persistWarnings = [];
    
    if (persist) {
        try {
            if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });

            // Write scan
            fs.writeFileSync(path.join(RUNTIME_DIR, `scan_${scanId}.json`), JSON.stringify(scan, null, 2));
            // Write opps
            newOpps.forEach(o => {
                fs.writeFileSync(path.join(RUNTIME_DIR, `${o.opp_id}.json`), JSON.stringify(o, null, 2));
            });
            
            // Update store.json
            const storePath = path.join(RUNTIME_DIR, 'store.json');
            const storeData = {
                scans: inMemoryScans.map(s => s.scan_id),
                opps: inMemoryOpps.map(o => o.opp_id),
                monitor_state: monitorState,
                llm_dataset_rows: runtimeData.llm_dataset_rows,
                llm_cache: runtimeData.llm_cache
            };
            const tempStorePath = storePath + '.tmp';
            fs.writeFileSync(tempStorePath, JSON.stringify(storeData, null, 2));
            fs.renameSync(tempStorePath, storePath); // Atomic write
        } catch (err) {
            console.error("Persist error:", err);
            persistWarnings.push(err.message);
        }
    }
    
    stepEnd('persist_store', stepPersist);
    logStage('persist_store', tPersist, { persist_enabled: persist }, { files_written: persist ? (1 + newOpps.length + 1) : 0 }, persistWarnings, []);
    
    // Update in-memory scan with the final log
    scan.stage_logs = [...stageLogs];
    scan.duration_ms = Date.now() - t0; // Update total duration
    metrics.total_ms = scan.duration_ms;
    
    // Return Result
    return {
        scan: scan,
        opportunities: newOpps,
        from_scan_id: fromScanId,
        to_scan_id: scanId,
        metrics: metrics,
        stage_logs: scan.stage_logs
    };
}

function createLLMDatasetRow(opp, ctx = {}) {
    const timestamp = new Date().toISOString();
    const row = {
        row_type: ctx.row_type || 'scan_row',
        ids: {
            batch_id: ctx.batch_id || null,
            scan_id: ctx.scan_id || 'unknown',
            opp_id: opp.opp_id,
            market_id: 'default',
            reeval_job_id: ctx.reeval_job_id || null
        },
        provider: {
            provider_name: opp.llm_provider || 'unknown',
            model: opp.llm_model || 'unknown',
            fallback_used: opp.llm_tags?.includes('fallback') || false,
            latency_ms: opp.llm_latency_ms || 0
        },
        input: {
            prompt_version: 'v1',
            prompt_compact: (opp.llm_input_prompt || '').substring(0, 100) + '...',
            extracted_context: ''
        },
        output: {
            llm_raw_text: (opp.llm_summary || '').substring(0, 200),
            llm_schema_json: opp.llm_json || null,
            confidence: opp.llm_confidence || 0
        },
        snapshot: {
            market_prob: opp.score_baseline || 0,
            best_bid_ask: null,
            timestamp: timestamp
        },
        scoring: {
            score_baseline: opp.score_baseline || 0,
            score_components: opp.score_components || {}
        },
        trigger: {
            trigger_reason: ctx.trigger_reason || 'initial'
        },
        news_refs: ctx.news_refs || []
    };
    
    // Hash
    const content = JSON.stringify(row);
    row.hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
    
    return row;
}

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
            if (data.monitor_state) runtimeData.monitor_state = data.monitor_state;
            if (data.llm_dataset_rows) runtimeData.llm_dataset_rows = data.llm_dataset_rows;
            if (data.llm_cache) runtimeData.llm_cache = data.llm_cache;
            
            // Merge Scans (hydrate from files)
            if (Array.isArray(runtimeData.scans)) {
                const loadedScans = [];
                for (const scanId of runtimeData.scans) {
                    if (!scanId) continue;
                    // If it's already an object (legacy), use it
                    if (typeof scanId === 'object') {
                        loadedScans.push(scanId);
                        continue;
                    }
                    const p = path.join(RUNTIME_DIR, `scan_${scanId}.json`);
                    if (fs.existsSync(p)) {
                        try {
                            loadedScans.push(JSON.parse(fs.readFileSync(p, 'utf8')));
                        } catch (e) {}
                    }
                }
                inMemoryScans = [...inMemoryScans, ...loadedScans];
            }

            // Merge Opps (hydrate from files)
            if (Array.isArray(runtimeData.opportunities)) {
                const loadedOpps = [];
                for (const oppId of runtimeData.opportunities) {
                    if (!oppId) continue;
                     // If it's already an object (legacy), use it
                    if (typeof oppId === 'object') {
                        loadedOpps.push(oppId);
                        continue;
                    }
                    const p = path.join(RUNTIME_DIR, `${oppId}.json`);
                    if (fs.existsSync(p)) {
                        try {
                            loadedOpps.push(JSON.parse(fs.readFileSync(p, 'utf8')));
                        } catch (e) {}
                    }
                }
                inMemoryOpps = [...inMemoryOpps, ...loadedOpps];
            }
            monitorState = { ...runtimeData.monitor_state };
            console.log(`Loaded ${inMemoryScans.length} scans (total), ${inMemoryOpps.length} opps (total) from runtime store.`);
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
        
        // SPECIAL CASE: Serve app.js from local dir if exists (for dev/workaround)
        if (relativePath === '/app.js' || relativePath === 'app.js') {
             const localAppJs = path.join(__dirname, 'app.js');
             if (fs.existsSync(localAppJs)) {
                 res.writeHead(200, { 'Content-Type': 'text/javascript' });
                 fs.createReadStream(localAppJs).pipe(res);
                 return;
             }
        }
        
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

    // GET /export/llm_analyze.json?scan=<id>
    if (pathname === '/export/llm_analyze.json') {
        const scanId = parsedUrl.query.scan;
        if (!scanId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing scan parameter' }));
            return;
        }

        // Search in memory first, then file
        let scan = inMemoryScans.find(s => s.scan_id === scanId);
        let opps = [];

        if (!scan && fs.existsSync(RUNTIME_DIR)) {
             const scanPath = path.join(RUNTIME_DIR, `scan_${scanId}.json`);
             if (fs.existsSync(scanPath)) {
                 try {
                     scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
                 } catch (e) {
                     // ignore
                 }
             }
        }

        if (!scan) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Scan not found' }));
            return;
        }

        // Fetch opps
        const oppIds = scan.opp_ids || [];
        opps = inMemoryOpps.filter(o => oppIds.includes(o.opp_id));
        
        // If not enough in memory, try load from disk
        if (opps.length < oppIds.length && fs.existsSync(RUNTIME_DIR)) {
            oppIds.forEach(oid => {
                if (!opps.find(o => o.opp_id === oid)) {
                    const p = path.join(RUNTIME_DIR, `${oid}.json`);
                    if (fs.existsSync(p)) {
                        try {
                            opps.push(JSON.parse(fs.readFileSync(p, 'utf8')));
                        } catch (e) {}
                    }
                }
            });
        }

        // Filter stage logs
        const llmLog = (scan.stage_logs || []).find(s => s.stage_id === 'llm_analyze');
        
        // Map opps to LLM fields
        const oppsSummary = opps.map(o => ({
            opp_id: o.opp_id,
            llm_provider: o.llm_provider,
            llm_model: o.llm_model,
            llm_summary: o.llm_summary,
            llm_confidence: o.llm_confidence,
            llm_tags: o.llm_tags,
            llm_latency_ms: o.llm_latency_ms,
            llm_error: o.llm_error,
            llm_json: o.llm_json
        }));

        const result = {
            scan_id: scan.scan_id,
            llm_analyze_stage: llmLog || null,
            opportunities: oppsSummary
        };

        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="llm_analyze_${scanId}.json"`
        });
        res.end(JSON.stringify(result, null, 2));
        return;
    }

    // GET /export/llm_dataset.jsonl
    if (pathname === '/export/llm_dataset.jsonl') {
        const { scan } = parsedUrl.query;
        let rows = [];
        let filename = '';

        if (scan) {
            rows = runtimeData.llm_dataset_rows.filter(r => r.ids.scan_id === scan);
            filename = `llm_dataset_${scan}.jsonl`;
        } else {
            const limit = 200; // Default N
            const max = 1000;
            // Get last N rows (up to max)
            // If we just want last 200 by default:
            const n = 200; 
            const count = Math.min(runtimeData.llm_dataset_rows.length, n);
            rows = runtimeData.llm_dataset_rows.slice(-count);
            filename = 'llm_dataset_latest.jsonl';
        }

        const content = rows.map(r => JSON.stringify(r)).join('\n');
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.writeHead(200, { 'Content-Type': 'application/jsonl; charset=utf-8' });
        res.end(content);
        return;
    }

    // POST /news/pull
    if (pathname === '/news/pull' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                let params = {};
                try { params = JSON.parse(body); } catch (e) {}

                const topic_key = params.topic_key || 'default';
                const requestedProvider = params.provider || process.env.NEWS_PROVIDER || 'local';
                
                // Validate maxrecords/limit
                let limit = 5; // default for local
                if (requestedProvider === 'gdelt') {
                    // Default 20 for gdelt
                    limit = params.maxrecords ? parseInt(params.maxrecords) : 20;
                    if (limit > 50) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'maxrecords cannot exceed 50' }));
                        return;
                    }
                } else {
                    limit = params.limit ? parseInt(params.limit) : 5;
                }

                // Cache Check
                const cacheParams = {
                    provider: requestedProvider,
                    topic_key: topic_key,
                    query: params.query,
                    timespan: params.timespan,
                    maxrecords: limit
                };
                const cacheKey = generateCacheKey(cacheParams);
                const cachedData = getFromCache(cacheKey);

                if (cachedData) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        ...cachedData, 
                        cached: true, 
                        cache_key: cacheKey 
                    }));
                    return;
                }

                let newsProvider = getNewsProvider(requestedProvider);
                let newsItems = [];
                let fallbackOccurred = false;
                let providerUsed = requestedProvider;

                try {
                    newsItems = await newsProvider.fetchNews(topic_key, limit, { 
                        query: params.query, 
                        timespan: params.timespan 
                    });
                } catch (e) {
                    console.error(`[NewsPull] Provider ${requestedProvider} failed: ${e.message}`);
                    if (requestedProvider !== 'local') {
                        console.log('[NewsPull] Falling back to local provider');
                        newsProvider = getNewsProvider('local');
                        // Local provider ignores query/timespan usually, and uses default limit 5 if we don't pass it?
                        // We should pass the limit we calculated or default local limit?
                        // Fallback usually implies safety. Local default is 5.
                        // Let's use the limit we have but cap it if needed? 
                        // Local provider fetchNews(topic, limit).
                        newsItems = await newsProvider.fetchNews(topic_key, 5); // Fallback usually safe default
                        fallbackOccurred = true;
                        providerUsed = 'local';
                    } else {
                        throw e;
                    }
                }
                
                let written = 0;
                let deduped = 0;
                let latest_news_id = null;

                for (const item of newsItems) {
                     const itemProvider = item.provider || providerUsed;
                     // Use robust hash input
                     const hashInput = itemProvider + (item.url || '') + (item.title || '') + (item.published_at || '');
                     const content_hash = crypto.createHash('sha256').update(hashInput).digest('hex');
                     
                     const res = await DB.appendNews({
                        topic_key: topic_key,
                        ts: new Date(item.published_at).getTime(),
                        title: item.title,
                        url: item.url,
                        publisher: item.source,
                        summary: item.snippet,
                        credibility: 0.8,
                        raw_json: item,
                        published_at: item.published_at,
                        content_hash: content_hash,
                        provider: itemProvider
                    });
                    if (res.inserted) written++;
                    else deduped++;
                    if (res.id) latest_news_id = res.id;
                }
                
                const result = { 
                    status: 'ok', 
                    fetched: newsItems.length, 
                    written, 
                    deduped, 
                    latest_news_id,
                    provider_used: providerUsed,
                    fallback: fallbackOccurred,
                    cached: false,
                    cache_key: cacheKey,
                    inserted_count: written,
                    deduped_count: deduped
                };

                // Cache the result (for 10 min)
                setInCache(cacheKey, result);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

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
            
            try {
                const result = await runScanCore(params);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (coreErr) {
                // If it's a known validation error, 400
                if (coreErr.message.includes('Invalid n_opps')) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: coreErr.message }));
                } else {
                    throw coreErr;
                }
            }
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
            return;
        }
    }

    // POST /scans/batch_run
    if (pathname === '/scans/batch_run' && req.method === 'POST') {
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
                     res.writeHead(400, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                     return;
                }
            }

            // Extract batch-level params
            let { topics, concurrency, persist, n_opps, seed, mode, dedup_window_sec, dedup_mode, cache_ttl_sec } = bodyParams;
            
            // Validation
            if (!topics || !Array.isArray(topics) || topics.length === 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing or empty topics array' }));
                return;
            }

            // Concurrency Control
            concurrency = (concurrency === undefined || concurrency === null) ? 4 : parseInt(concurrency, 10);
            if (concurrency > 16) concurrency = 16; // Hard cap
            if (concurrency < 1) concurrency = 1;

            // Defaults
            persist = (persist === undefined) ? true : (String(persist) === 'true');
            const batchId = 'batch_' + crypto.createHash('sha256').update(Date.now().toString() + Math.random().toString()).digest('hex').substring(0, 8);
            const startedAt = new Date().toISOString();
            
            // Prepare results array
            const results = [];
            const summaryMetrics = {
                batch_id: batchId, // Add explicit batch_id in summary
                total_topics: topics.length,
                success_count: 0,
                failed_count: 0,
                skipped_count: 0,
                total_duration_ms: 0,
                start_ts: startedAt,
                end_ts: null
            };

            // Helper for processing a single topic
            const processTopic = async (topicItem) => {
                const topicKey = typeof topicItem === 'string' ? topicItem : topicItem.topic_key;
                const topicParams = typeof topicItem === 'object' ? topicItem : {};
                
                // Merge params: topic-specific > batch-level > default
                const runParams = {
                    topic_key: topicKey,
                    batch_id: batchId, // Pass batch_id
                    n_opps: (topicParams.n_opps !== undefined && topicParams.n_opps !== null) ? topicParams.n_opps : n_opps,
                    seed: (topicParams.seed !== undefined && topicParams.seed !== null) ? topicParams.seed : seed,
                    mode: topicParams.mode || mode,
                    dedup_window_sec: (topicParams.dedup_window_sec !== undefined && topicParams.dedup_window_sec !== null) ? topicParams.dedup_window_sec : dedup_window_sec,
                    dedup_mode: topicParams.dedup_mode || dedup_mode,
                    cache_ttl_sec: (topicParams.cache_ttl_sec !== undefined && topicParams.cache_ttl_sec !== null) ? topicParams.cache_ttl_sec : cache_ttl_sec,
                    persist: persist
                };

                try {
                    const result = await runScanCore(runParams);
                    const isSkipped = result.skipped === true;
                    
                    return {
                        topic_key: topicKey,
                        topic_status: isSkipped ? 'SKIPPED' : 'OK',
                        scan_id: result.scan?.scan_id || result.scan_id, // handle skipped structure
                        opps_count: result.scan?.n_opps_actual || result.opportunities?.length || 0,
                        duration_ms: result.metrics?.total_ms || result.scan?.duration_ms || 0,
                        metrics: result.metrics,
                        stage_logs: result.stage_logs,
                        error: null
                    };
                } catch (err) {
                    console.error(`Batch topic failed [${topicKey}]:`, err);
                    return {
                        topic_key: topicKey,
                        topic_status: 'FAILED',
                        scan_id: null,
                        duration_ms: 0,
                        metrics: null,
                        stage_logs: [],
                        error: err.message
                    };
                }
            };

            // Execute with concurrency
            // Chunking strategy
            for (let i = 0; i < topics.length; i += concurrency) {
                const chunk = topics.slice(i, i + concurrency);
                const chunkResults = await Promise.all(chunk.map(processTopic));
                results.push(...chunkResults);
            }

            // Summarize
            const endAt = new Date().toISOString();
            summaryMetrics.end_ts = endAt;
            summaryMetrics.total_duration_ms = new Date(endAt).getTime() - new Date(startedAt).getTime();
            
            results.forEach(r => {
                if (r.topic_status === 'OK') summaryMetrics.success_count++;
                else if (r.topic_status === 'FAILED') summaryMetrics.failed_count++;
                else if (r.topic_status === 'SKIPPED') summaryMetrics.skipped_count++;
            });

            const batchResult = {
                batch_id: batchId,
                started_at: startedAt,
                params: { topics, concurrency, persist, n_opps, seed, mode, dedup_window_sec },
                results: results,
                summary_metrics: summaryMetrics
            };

            // Store in memory
            inMemoryBatches.push(batchResult);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(batchResult));
            return;

        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
            return;
        }
    }

    // GET /export/batch_run.json
    if (pathname === '/export/batch_run.json') {
        const batchId = parsedUrl.query.batch_id;
        if (!batchId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing batch_id parameter' }));
            return;
        }

        const batch = inMemoryBatches.find(b => b.batch_id === batchId);
        
        if (!batch) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Batch not found' }));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="batch_run_${batchId}.json"`
        });
        res.end(JSON.stringify(batch, null, 2));
        return;
    }

    // GET /export/batch_dataset.jsonl
    if (pathname === '/export/batch_dataset.jsonl') {
        const { batch_id, limit } = parsedUrl.query;
        let rows = [];
        let filename = '';

        if (batch_id) {
            rows = runtimeData.llm_dataset_rows.filter(r => r.ids && r.ids.batch_id === batch_id);
            filename = `batch_dataset_${batch_id}.jsonl`;
        } else {
            const n = parseInt(limit) || 200; 
            const count = Math.min(runtimeData.llm_dataset_rows.length, n);
            rows = runtimeData.llm_dataset_rows.slice(-count);
            filename = 'batch_dataset_latest.jsonl';
        }

        const content = rows.map(r => JSON.stringify(r)).join('\n');
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.writeHead(200, { 'Content-Type': 'application/jsonl; charset=utf-8' });
        res.end(content);
        return;
    }

    // POST /monitor/tick
    if (pathname === '/monitor/tick' && req.method === 'POST') {
        const bodyPromise = new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        try {
            const rawBody = await bodyPromise;
            const params = JSON.parse(rawBody || '{}');
            const { universe = 'all', now_ts, simulate_price_move = false } = params;
            
            const ts = now_ts ? new Date(now_ts).getTime() : Date.now();
            const stageLogs = [];
            const logStage = (id, start, input, output) => {
                stageLogs.push({ stage_id: id, start_ts: new Date(start).toISOString(), end_ts: new Date().toISOString(), dur_ms: Date.now() - start, input_summary: input, output_summary: output });
            };

            const tStart = Date.now();
            
            // 1. Select Opps
            let targetOpps = [];
            if (universe === 'all') {
                targetOpps = inMemoryOpps;
            } else if (universe.startsWith('scan:')) {
                const scanId = universe.split(':')[1];
                const scan = inMemoryScans.find(s => s.scan_id === scanId);
                if (scan) {
                    const ids = new Set(scan.opp_ids || []);
                    targetOpps = inMemoryOpps.filter(o => ids.has(o.opp_id));
                }
            } else if (universe.startsWith('top:')) {
                const n = parseInt(universe.split(':')[1]) || 5;
                targetOpps = inMemoryOpps.slice(0, n);
            }
            
            // 2. Update Logic
            let updatedCount = 0;
            let changedCount = 0;
            const topMoves = []; // { opp_id, delta, new_prob }
            
            targetOpps.forEach(opp => {
                const oid = opp.opp_id;
                // Init state if missing
                if (!monitorState[oid]) {
                    monitorState[oid] = {
                        baseline_prob: opp.score_baseline || opp.score || 50,
                        last_prob: opp.score_baseline || opp.score || 50,
                        last_seen_ts: ts,
                        last_reeval_ts: 0,
                        trigger_state: 'ARMED',
                        last_trigger_reason: null
                    };
                }
                
                const state = monitorState[oid];
                const prevProb = state.last_prob;
                
                if (simulate_price_move) {
                    // Random walk: -5 to +5
                    const delta = (Math.random() - 0.5) * 10;
                    let newProb = prevProb + delta;
                    if (newProb < 0) newProb = 0;
                    if (newProb > 100) newProb = 100;
                    
                    state.last_prob = parseFloat(newProb.toFixed(2));
                    if (Math.abs(state.last_prob - prevProb) > 0.01) {
                        changedCount++;
                        topMoves.push({ opp_id: oid, delta: parseFloat(delta.toFixed(2)), new_prob: state.last_prob });
                    }
                }
                
                state.last_seen_ts = ts;
                updatedCount++;
            });
            
            // Sort top moves by abs delta descending
            topMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
            
            logStage('monitor_tick', tStart, { universe, simulate_price_move }, { updated: updatedCount, changed: changedCount });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ updated_count: updatedCount, changed_count: changedCount, top_moves: topMoves.slice(0, 10), stage_logs: stageLogs }));
            return;
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
        }
    }

    // POST /reeval/plan
    if (pathname === '/reeval/plan' && req.method === 'POST') {
        const bodyPromise = new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        try {
            const rawBody = await bodyPromise;
            const params = JSON.parse(rawBody || '{}');
            const { 
                abs_threshold = 10, 
                rel_threshold = 0.2, 
                speed_threshold = 5, 
                staleness_min = 60, // minutes
                hysteresis_reset = 2,
                max_jobs = 10
            } = params;

            const tStart = Date.now();
            const stageLogs = [];
            const jobs = [];
            const skipped = [];
            const now = Date.now();
            
            Object.keys(monitorState).forEach(oid => {
                const state = monitorState[oid];
                const p = state.last_prob;
                const baseline = state.baseline_prob;
                const diff = Math.abs(p - baseline);
                
                // Hysteresis Logic
                if (state.trigger_state === 'COOLDOWN') {
                    if (diff <= hysteresis_reset) {
                        state.trigger_state = 'ARMED'; // Reset
                    } else {
                        skipped.push({ opp_id: oid, reason: 'COOLDOWN' });
                        return;
                    }
                }
                
                if (state.trigger_state === 'TRIGGERED') {
                    skipped.push({ opp_id: oid, reason: 'ALREADY_TRIGGERED' });
                    return; // Already pending
                }
                
                if (state.trigger_state === 'ARMED') {
                    let reason = null;
                    
                    // Check triggers
                    // 1. Abs
                    if (diff >= abs_threshold) reason = `ABS_DIFF >= ${abs_threshold}`;
                    
                    // 2. Rel
                    else if (baseline > 0 && (diff / baseline) >= rel_threshold) reason = `REL_DIFF >= ${rel_threshold}`;
                    
                    // 3. Staleness
                    else if ((now - state.last_reeval_ts) > (staleness_min * 60 * 1000) && state.last_reeval_ts > 0) reason = `STALENESS >= ${staleness_min}m`;
                    
                    if (reason) {
                        state.trigger_state = 'TRIGGERED';
                        state.last_trigger_reason = reason;
                        jobs.push({
                            option_id: oid,
                            reason: reason,
                            from_prob: baseline,
                            to_prob: p
                        });
                    }
                }
            });
            
            // Limit jobs
            const finalJobs = jobs.slice(0, max_jobs);
            
            stageLogs.push({ stage_id: 'reeval_plan', start_ts: new Date(tStart).toISOString(), end_ts: new Date().toISOString(), dur_ms: Date.now() - tStart, input_summary: params, output_summary: { jobs_count: finalJobs.length } });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jobs: finalJobs, skipped: skipped.slice(0, 10), stage_logs: stageLogs }));
            return;
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
        }
    }

    // POST /reeval/run
    if (pathname === '/reeval/run' && req.method === 'POST') {
        const bodyPromise = new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        try {
            const rawBody = await bodyPromise;
            const params = JSON.parse(rawBody || '{}');
            const { jobs = [], provider = 'mock', dry_run = false } = params;

            const tStart = Date.now();
            const results = [];
            const stageLogs = [];
            
            for (const job of jobs) {
                const oid = job.option_id;
                const state = monitorState[oid];
                
                if (state && !dry_run) {
                    // Update Baseline
                    state.baseline_prob = state.last_prob;
                    state.last_reeval_ts = Date.now();
                    state.trigger_state = 'COOLDOWN'; // Enter cooldown
                    
                    // In a real system, we'd call LLM here.
                    // For mock, we generate a fake result.
                    const reevalResult = {
                        option_id: oid,
                        status: 'COMPLETED',
                        new_baseline: state.baseline_prob,
                        llm_summary: `Re-evaluated due to ${job.reason}. New probability ${state.baseline_prob}.`
                    };
                    results.push(reevalResult);

                    // DB: Append Reeval Event (Fail-soft)
                    try {
                        // We need topic_key. Usually available in monitorState or job.
                        // Assuming monitorState has topic info? 
                        // Actually monitorState keys are just option_id. We might need to lookup topic.
                        // For now, scan inMemoryOpps to find topic_key for this option_id.
                        const oppRef = inMemoryOpps.find(o => o.opp_id === oid);
                        const topicKey = oppRef ? (oppRef.topic_key || 'default_topic') : 'unknown';

                        // Fetch News
                        let newsRefs = [];
                        try {
                            const recentNews = await DB.getRecentNews(topicKey, 3);
                            newsRefs = recentNews.map(n => n.id);
                        } catch(e) { console.error('Error fetching news for Reeval:', e); }

                        await DB.appendReevalEvent({
                            id: `rev_${Date.now()}_${oid}`,
                            topic_key: topicKey,
                            option_id: oid,
                            ts: Date.now(),
                            trigger_json: { reason: job.reason, from: job.from_prob, to: job.to_prob },
                            before_json: { prob: job.from_prob },
                            after_json: { prob: state.baseline_prob },
                            batch_id: null, // Not easily available here unless passed in params
                            scan_id: null,
                            news_refs: newsRefs
                        });
                    } catch (e) { console.error('DB appendReevalEvent fail:', e); }

                    // Create Reeval Row
                    try {
                        const reevalOpp = {
                            opp_id: oid,
                            llm_provider: provider,
                            llm_model: 'mock-reeval',
                            llm_summary: reevalResult.llm_summary,
                            llm_confidence: 1.0,
                            llm_tags: ['reeval', 'mock'],
                            llm_latency_ms: 50,
                            score_baseline: state.baseline_prob,
                            score_components: { prev: state.last_prob, new: state.baseline_prob }
                        };
                        
                        // Find batch_id from previous scan row
                        const previousRow = runtimeData.llm_dataset_rows.slice().reverse().find(r => 
                            r.ids.opp_id === oid && 
                            r.ids.batch_id && 
                            r.row_type === 'scan_row'
                        );
                        const linkedBatchId = previousRow ? previousRow.ids.batch_id : null;

                        const datasetRow = createLLMDatasetRow(reevalOpp, {
                            row_type: 'reeval_row',
                            scan_id: 'unknown', // or find last scan id
                            reeval_job_id: `job_${Date.now()}_${oid}`,
                            trigger_reason: job.reason,
                            batch_id: linkedBatchId,
                            news_refs: newsRefs
                        });
                        runtimeData.llm_dataset_rows.push(datasetRow);
                    } catch (e) {
                        console.error("Error creating reeval row:", e);
                    }
                } else {
                    results.push({ option_id: oid, status: 'SKIPPED_OR_DRY_RUN' });
                }
            }
            
            stageLogs.push({ stage_id: 'reeval_run', start_ts: new Date(tStart).toISOString(), end_ts: new Date().toISOString(), dur_ms: Date.now() - tStart, input_summary: { jobs_count: jobs.length, provider }, output_summary: { processed: results.length } });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ reevaluated_count: results.length, results: results, stage_logs: stageLogs }));
            return;
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
        }
    }

    // GET /export/monitor_state.json
    if (pathname === '/export/monitor_state.json') {
        const content = JSON.stringify(monitorState, null, 2);
        res.setHeader('Content-Disposition', `attachment; filename="monitor_state_${Date.now()}.json"`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(content);
        return;
    }

    if (pathname === '/export/stage_logs.json') {
        // Export Stage Logs
        const { scan } = parsedUrl.query;
        if (!scan) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing scan parameter');
            return;
        }
        
        // Find scan
        const scanRecord = inMemoryScans.find(s => s.scan_id === scan);
        if (!scanRecord) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Scan not found');
            return;
        }
        
        const content = JSON.stringify(scanRecord.stage_logs || [], null, 2);
        res.setHeader('Content-Disposition', `attachment; filename="stage_logs_${scan}.json"`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(content);
        return;
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

    // 5. Timeline DB Routes
    if (pathname === '/timeline/append_snapshot' && req.method === 'POST') {
        const bodyPromise = new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });

        try {
            const rawBody = await bodyPromise;
            const params = JSON.parse(rawBody || '{}');
            await DB.appendSnapshot(params);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', id: params.id }));
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === '/timeline/topic') {
        const { topic_key, limit } = parsedUrl.query;
        if (!topic_key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing topic_key' }));
            return;
        }
        try {
            const rows = await DB.getTimeline(topic_key, limit ? parseInt(limit) : 50);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rows));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (pathname === '/export/timeline.jsonl') {
        const { topic_key } = parsedUrl.query;
        if (!topic_key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing topic_key' }));
            return;
        }
        try {
            const rows = await DB.getAllTimelineForExport(topic_key);
            const content = rows.map(r => JSON.stringify(r)).join('\n');
            res.setHeader('Content-Disposition', `attachment; filename="timeline_${topic_key}.jsonl"`);
            res.writeHead(200, { 'Content-Type': 'application/jsonl; charset=utf-8' });
            res.end(content);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
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
