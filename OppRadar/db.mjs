import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB Path: E:\OppRadar\data\runtime\oppradar.sqlite
// OppRadar root is parent of __dirname (OppRadar/OppRadar -> OppRadar)
// But strictly speaking, if we run from root, we can just use process.cwd()
// Let's rely on process.cwd() being E:\OppRadar as established in context
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
    // Write Methods (fail-soft wrapper expected in caller or here? Caller is safer but we can log error here)
    async appendTopic(topic_key, meta = {}) {
        try {
            await runAsync(`INSERT OR IGNORE INTO topic (topic_key, created_at, meta_json) VALUES (?, ?, ?)`, 
                [topic_key, Date.now(), JSON.stringify(meta)]);
        } catch (e) {
            console.error('[DB] appendTopic error:', e.message);
        }
    },

    async appendSnapshot(snapshot) {
        // snapshot: { id, topic_key, option_id, ts, prob, market_price, source, raw_json }
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
    
    // Read Methods
    async getTimeline(topic_key, limit = 50) {
        try {
            // Union all events? Or return separate arrays? User asked for "aggregated timeline"
            // Let's fetch separately and merge in memory for simplicity as schemas differ
            const snapshots = await allAsync(`SELECT 'snapshot' as type, * FROM option_snapshot WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const llm_rows = await allAsync(`SELECT 'llm' as type, * FROM llm_row WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            const reevals = await allAsync(`SELECT 'reeval' as type, * FROM reeval_event WHERE topic_key = ? ORDER BY ts DESC LIMIT ?`, [topic_key, limit]);
            
            const all = [...snapshots, ...llm_rows, ...reevals];
            all.sort((a, b) => b.ts - a.ts); // Descending
            return all.slice(0, limit);
        } catch (e) {
            console.error('[DB] getTimeline error:', e.message);
            return [];
        }
    },

    async getAllTimelineForExport(topic_key) {
        try {
            const snapshots = await allAsync(`SELECT 'snapshot' as type, * FROM option_snapshot WHERE topic_key = ?`, [topic_key]);
            const llm_rows = await allAsync(`SELECT 'llm' as type, * FROM llm_row WHERE topic_key = ?`, [topic_key]);
            const reevals = await allAsync(`SELECT 'reeval' as type, * FROM reeval_event WHERE topic_key = ?`, [topic_key]);
            
            const all = [...snapshots, ...llm_rows, ...reevals];
            all.sort((a, b) => a.ts - b.ts); // Ascending for export
            return all;
        } catch (e) {
            console.error('[DB] getAllTimelineForExport error:', e.message);
            return [];
        }
    }
};

export default DB;
