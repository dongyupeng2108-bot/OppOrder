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
            raw_json TEXT
        )`);
        
        // Indices for performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_snapshot_topic_ts ON option_snapshot(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_llm_topic_ts ON llm_row(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_reeval_topic_ts ON reeval_event(topic_key, ts)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_news_topic_ts ON news_stub(topic_key, ts)`);
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
            await runAsync(`INSERT INTO llm_row (id, topic_key, option_id, ts, provider, model, prompt_hash, llm_json, tags_json, latency_ms, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    JSON.stringify(row.raw_json || {})
                ]
            );
        } catch (e) {
            console.error('[DB] appendLLMRow error:', e.message);
        }
    },

    async appendReevalEvent(event) {
        try {
            const id = event.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO reeval_event (id, topic_key, option_id, ts, trigger_json, before_json, after_json, batch_id, scan_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    event.topic_key,
                    event.option_id,
                    event.ts || Date.now(),
                    JSON.stringify(event.trigger_json || {}),
                    JSON.stringify(event.before_json || {}),
                    JSON.stringify(event.after_json || {}),
                    event.batch_id,
                    event.scan_id
                ]
            );
        } catch (e) {
            console.error('[DB] appendReevalEvent error:', e.message);
        }
    },

    async appendNews(newsItem) {
        try {
            const id = newsItem.id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await runAsync(`INSERT INTO news_stub (
                id, topic_key, ts, title, url, publisher, summary, credibility, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                newsItem.topic_key,
                newsItem.ts || Date.now(),
                newsItem.title,
                newsItem.url,
                newsItem.publisher,
                newsItem.summary,
                newsItem.credibility || 0.5,
                JSON.stringify(newsItem.raw_json || {})
            ]);
        } catch (e) {
            console.error('[DB] appendNews error:', e.message);
        }
    },
    
    // Read Methods
    async getTimeline(topic_key, limit = 50) {
        try {
            const snapshots = await allAsync(`SELECT 'snapshot' as type, id, topic_key, ts, prob as val1, market_price as val2, source as info, raw_json FROM option_snapshot WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const llm_rows = await allAsync(`SELECT 'llm' as type, id, topic_key, ts, latency_ms as val1, 0 as val2, model as info, raw_json FROM llm_row WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const reevals = await allAsync(`SELECT 'reeval' as type, id, topic_key, ts, 0 as val1, 0 as val2, 'trigger' as info, trigger_json as raw_json FROM reeval_event WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const news = await allAsync(`SELECT 'news' as type, id, topic_key, ts, credibility as val1, 0 as val2, publisher as info, raw_json FROM news_stub WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            
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
    }
};

export default DB;
