import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB Path: E:\OppRadar\data\runtime\oppradar.sqlite
const DB_DIR = path.join(process.cwd(), 'data', 'runtime');
const DB_PATH = path.join(DB_DIR, 'oppradar.sqlite');

// Ensure directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to SQLite database at', DB_PATH);
        initSchema();
    }
});

function initSchema() {
    db.serialize(() => {
        // Topic Table
        db.run(`CREATE TABLE IF NOT EXISTS topic (
            topic_key TEXT PRIMARY KEY,
            created_at INTEGER,
            meta_json TEXT
        )`);

        // Option Snapshot
        db.run(`CREATE TABLE IF NOT EXISTS option_snapshot (
            id TEXT PRIMARY KEY,
            topic_key TEXT,
            option_id TEXT,
            ts INTEGER,
            prob REAL,
            market_price REAL,
            source TEXT,
            raw_json TEXT
        )`);

        // LLM Row
        db.run(`CREATE TABLE IF NOT EXISTS llm_row (
            id TEXT PRIMARY KEY,
            topic_key TEXT,
            option_id TEXT,
            ts INTEGER,
            provider TEXT,
            model TEXT,
            prompt_hash TEXT,
            llm_json TEXT,
            tags_json TEXT,
            latency_ms INTEGER,
            raw_json TEXT
        )`);

        // Reeval Event
        db.run(`CREATE TABLE IF NOT EXISTS reeval_event (
            id TEXT PRIMARY KEY,
            topic_key TEXT,
            option_id TEXT,
            ts INTEGER,
            trigger_json TEXT,
            before_json TEXT,
            after_json TEXT,
            batch_id TEXT,
            scan_id TEXT
        )`);

        // News Stub
        db.run(`CREATE TABLE IF NOT EXISTS news_stub (
            id TEXT PRIMARY KEY,
            topic_key TEXT,
            ts INTEGER,
            title TEXT,
            url TEXT,
            publisher TEXT,
            summary TEXT,
            credibility REAL,
            published_at TEXT,
            content_hash TEXT,
            raw_json TEXT,
            provider TEXT
        )`);

        // Opportunity Event (Append-Only)
        db.run(`CREATE TABLE IF NOT EXISTS opportunity_event (
            id TEXT PRIMARY KEY,
            ts INTEGER,
            topic_key TEXT,
            score REAL,
            score_breakdown_json TEXT,
            features_json TEXT,
            snapshot_ref TEXT,
            llm_ref TEXT,
            news_refs_json TEXT,
            build_run_id TEXT,
            refs_json TEXT
        )`);

        // Opportunity Run (Summary)
        db.run(`CREATE TABLE IF NOT EXISTS opportunity_run (
            run_id TEXT PRIMARY KEY,
            ts INTEGER,
            jobs_total INTEGER,
            jobs_ok INTEGER,
            jobs_failed INTEGER,
            inserted_count INTEGER,
            concurrency INTEGER,
            meta_json TEXT
        )`);
        
        // Migrations (Idempotent) - Run BEFORE indices to ensure columns exist
        db.run(`ALTER TABLE llm_row ADD COLUMN news_refs TEXT`, (err) => {});
        db.run(`ALTER TABLE reeval_event ADD COLUMN news_refs TEXT`, (err) => {});
        db.run(`ALTER TABLE news_stub ADD COLUMN published_at TEXT`, (err) => {});
        db.run(`ALTER TABLE news_stub ADD COLUMN content_hash TEXT`, (err) => {});
        db.run(`ALTER TABLE news_stub ADD COLUMN provider TEXT`, (err) => {});
        db.run(`ALTER TABLE opportunity_event ADD COLUMN refs_json TEXT`, (err) => {});

        // Indices for performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_snapshot_topic_ts ON option_snapshot(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_topic_ts ON llm_row(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_reeval_topic_ts ON reeval_event(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_news_topic_ts ON news_stub(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_opp_ts_score ON opportunity_event(ts, score)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_opp_run_id ON opportunity_event(build_run_id)`);
        
        // Unique Index for News Deduplication (Provider-Aware)
        // Drop old restrictive index if exists (migration from v21)
        db.run(`DROP INDEX IF EXISTS idx_news_content_hash`);
        // Create new provider-aware unique index
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_news_content_hash_provider ON news_stub(topic_key, content_hash, provider)`);
    });
}

// Helper to run async
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// --- Public API ---

export const DB = {
    // Write Methods
    async appendTopic(topic_key, meta = {}) {
        try {
            await runAsync(`INSERT OR IGNORE INTO topic (topic_key, created_at, meta_json) VALUES (?, ?, ?)`, 
                [topic_key, Date.now(), JSON.stringify(meta)]);
        } catch (e) {
            console.error('[DB] appendTopic error:', e.message);
        }
    },

    async appendSnapshot(snapshot) {
        try {
            const id = snapshot.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO option_snapshot (id, topic_key, option_id, ts, prob, market_price, source, raw_json) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [
                    id, 
                    snapshot.topic_key, 
                    snapshot.option_id, 
                    snapshot.ts || Date.now(), 
                    snapshot.prob, 
                    snapshot.market_price, 
                    snapshot.source, 
                    typeof snapshot.raw_json === 'string' ? snapshot.raw_json : JSON.stringify(snapshot.raw_json || {})
                ]
            );
        } catch (e) {
            console.error('[DB] appendSnapshot error:', e.message);
        }
    },

    async appendLLMRow(row) {
        try {
            const id = row.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO llm_row (id, topic_key, option_id, ts, provider, model, prompt_hash, llm_json, tags_json, latency_ms, raw_json, news_refs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    row.topic_key,
                    row.option_id,
                    row.ts || Date.now(),
                    row.provider,
                    row.model,
                    row.prompt_hash,
                    JSON.stringify(row.llm_json || {}),
                    JSON.stringify(row.tags_json || []),
                    row.latency_ms,
                    JSON.stringify(row.raw_json || {}),
                    JSON.stringify(row.news_refs || [])
                ]
            );
        } catch (e) {
            console.error('[DB] appendLLMRow error:', e.message);
        }
    },

    async appendReevalEvent(event) {
        try {
            const id = event.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO reeval_event (id, topic_key, option_id, ts, trigger_json, before_json, after_json, batch_id, scan_id, news_refs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    event.topic_key,
                    event.option_id,
                    event.ts || Date.now(),
                    JSON.stringify(event.trigger_json || {}),
                    JSON.stringify(event.before_json || {}),
                    JSON.stringify(event.after_json || {}),
                    event.batch_id,
                    event.scan_id,
                    JSON.stringify(event.news_refs || [])
                ]
            );
        } catch (e) {
            console.error('[DB] appendReevalEvent error:', e.message);
        }
    },

    async appendNews(newsItem) {
        try {
            const id = newsItem.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Uses INSERT OR IGNORE to rely on unique index on (topic_key, content_hash)
            const result = await runAsync(`INSERT OR IGNORE INTO news_stub (
                id, topic_key, ts, title, url, publisher, summary, credibility, raw_json, published_at, content_hash, provider
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                newsItem.topic_key,
                newsItem.ts || Date.now(),
                newsItem.title,
                newsItem.url,
                newsItem.publisher,
                newsItem.summary,
                newsItem.credibility || 0.5,
                JSON.stringify(newsItem.raw_json || {}),
                newsItem.published_at || null,
                newsItem.content_hash || null,
                newsItem.provider || 'local'
            ]);
            return { id, inserted: result.changes > 0 };
        } catch (e) {
            console.error('[DB] appendNews error:', e.message);
            return { id: null, inserted: false };
        }
    },

    async appendOpportunity(opp) {
        try {
            const id = opp.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO opportunity_event (
                id, ts, topic_key, score, score_breakdown_json, features_json, snapshot_ref, llm_ref, news_refs_json, build_run_id, refs_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                opp.ts || Date.now(),
                opp.topic_key,
                opp.score,
                JSON.stringify(opp.score_breakdown || {}),
                JSON.stringify(opp.features || {}),
                opp.snapshot_ref || null,
                opp.llm_ref || null,
                JSON.stringify(opp.news_refs || []),
                opp.build_run_id || null,
                JSON.stringify(opp.refs || {})
            ]);
            return id;
        } catch (e) {
            console.error('[DB] appendOpportunity error:', e.message);
            return null;
        }
    },
    
    // Read Methods
    async getAllTopics() {
        try {
            const rows = await allAsync(`SELECT topic_key FROM topic`);
            return rows.map(r => r.topic_key);
        } catch (e) {
            console.error('[DB] getAllTopics error:', e.message);
            return [];
        }
    },

    async getRecentNews(topic_key, limit = 3) {
        try {
            return await allAsync(`SELECT * FROM news_stub WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
        } catch (e) {
            console.error('[DB] getRecentNews error:', e.message);
            return [];
        }
    },

    async getTimeline(topic_key, limit = 50) {
        try {
            const snapshots = await allAsync(`SELECT 'snapshot' as type, id, topic_key, ts, prob as val1, market_price as val2, source as info, raw_json FROM option_snapshot WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const llm_rows = await allAsync(`SELECT 'llm' as type, id, topic_key, ts, latency_ms as val1, 0 as val2, model as info, raw_json, news_refs FROM llm_row WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const reevals = await allAsync(`SELECT 'reeval' as type, id, topic_key, ts, 0 as val1, 0 as val2, 'trigger' as info, trigger_json as raw_json, news_refs FROM reeval_event WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const news = await allAsync(`SELECT 'news' as type, id, topic_key, ts, credibility as val1, 0 as val2, publisher as info, raw_json, url, title, content_hash FROM news_stub WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            
            const all = [...snapshots, ...llm_rows, ...reevals, ...news];
            all.sort((a, b) => b.ts - a.ts); // Descending
            return all.slice(0, limit);
        } catch (e) {
            console.error('[DB] getTimeline error:', e.message);
            return [];
        }
    },

    async getAllTimelineForExport(topic_key) {
        try {
            const snapshots = await allAsync(`SELECT 'snapshot' as row_type, * FROM option_snapshot WHERE topic_key = ?`, [topic_key]);
            const llm_rows = await allAsync(`SELECT 'llm' as row_type, * FROM llm_row WHERE topic_key = ?`, [topic_key]);
            const reevals = await allAsync(`SELECT 'reeval' as row_type, * FROM reeval_event WHERE topic_key = ?`, [topic_key]);
            const news = await allAsync(`SELECT 'news' as row_type, * FROM news_stub WHERE topic_key = ?`, [topic_key]);
            
            const all = [...snapshots, ...llm_rows, ...reevals, ...news];
            all.sort((a, b) => a.ts - b.ts); // Ascending for export
            return all;
        } catch (e) {
            console.error('[DB] getAllTimelineForExport error:', e.message);
            return [];
        }
    },

    async appendRun(run) {
        try {
            await runAsync(`INSERT INTO opportunity_run (
                run_id, ts, jobs_total, jobs_ok, jobs_failed, inserted_count, concurrency, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
                run.run_id,
                run.ts || Date.now(),
                run.jobs_total,
                run.jobs_ok,
                run.jobs_failed,
                run.inserted_count,
                run.concurrency,
                JSON.stringify(run.meta || {})
            ]);
            return run.run_id;
        } catch (e) {
            console.error('[DB] appendRun error:', e.message);
            return null;
        }
    },

    async getRuns(limit = 5) {
        try {
            const rows = await allAsync(`SELECT * FROM opportunity_run ORDER BY ts DESC LIMIT ?`, [limit]);
            return rows.map(r => ({
                ...r,
                meta: JSON.parse(r.meta_json || '{}')
            }));
        } catch (e) {
            console.error('[DB] getRuns error:', e.message);
            return [];
        }
    },

    async getOpportunitiesByRun(run_id, limit = 20) {
        try {
            const rows = await allAsync(`SELECT * FROM opportunity_event WHERE build_run_id = ? ORDER BY score DESC LIMIT ?`, [run_id, limit]);
            return rows.map(row => ({
                ...row,
                score_breakdown: JSON.parse(row.score_breakdown_json || '{}'),
                features: JSON.parse(row.features_json || '{}'),
                news_refs: JSON.parse(row.news_refs_json || '[]'),
                refs: JSON.parse(row.refs_json || '{}')
            }));
        } catch (e) {
            console.error('[DB] getOpportunitiesByRun error:', e.message);
            return [];
        }
    },

    async getTopOpportunities(limit = 20) {
        try {
            // Get the latest build_run_id first to ensure we show results from the most recent run
            // Or just sort by ts DESC, score DESC. 
            // The requirement implies "current top list". 
            // Let's assume we want the most recent global set, but typically opportunities are generated in batches.
            // A simple strategy is: take top N by score from the last X hours, or just simple latest by ts/score.
            // Given the requirement "GET /opportunities/top", let's fetch the most recent ones first.
            // If we want "top scored", we should probably filter by a recent time window.
            // For now, let's implement: Sort by ts DESC (freshness) then score DESC.
            // Wait, "Top Opportunities" usually means "Highest Score".
            // So we should find the latest `build_run_id` and get its top scores.
            
            const latestRun = await allAsync(`SELECT build_run_id FROM opportunity_event ORDER BY ts DESC LIMIT 1`);
            if (!latestRun || latestRun.length === 0) return [];
            
            const runId = latestRun[0].build_run_id;
            
            const rows = await allAsync(`SELECT * FROM opportunity_event WHERE build_run_id = ? ORDER BY score DESC LIMIT ?`, [runId, limit]);
            
            return rows.map(row => ({
                ...row,
                score_breakdown: JSON.parse(row.score_breakdown_json || '{}'),
                features: JSON.parse(row.features_json || '{}'),
                news_refs: JSON.parse(row.news_refs_json || '[]'),
                refs: JSON.parse(row.refs_json || '{}')
            }));
        } catch (e) {
            console.error('[DB] getTopOpportunities error:', e.message);
            return [];
        }
    },

    async getOpportunitiesForExport(sinceTs = 0) {
        try {
            const rows = await allAsync(`SELECT * FROM opportunity_event WHERE ts > ? ORDER BY ts ASC`, [sinceTs]);
            return rows.map(row => ({
                ...row,
                score_breakdown: JSON.parse(row.score_breakdown_json || '{}'),
                features: JSON.parse(row.features_json || '{}'),
                news_refs: JSON.parse(row.news_refs_json || '[]'),
                refs: JSON.parse(row.refs_json || '{}')
            }));
        } catch (e) {
            console.error('[DB] getOpportunitiesForExport error:', e.message);
            return [];
        }
    }
};

export default DB;
