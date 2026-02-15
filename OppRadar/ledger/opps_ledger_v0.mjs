import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to ledger file: data/opps_ledger/opps_ledger.jsonl
const LEDGER_PATH = path.join(__dirname, '../../data/opps_ledger/opps_ledger.jsonl');
console.log('[Ledger] Init. Path:', LEDGER_PATH);

// Ensure directory exists
const ledgerDir = path.dirname(LEDGER_PATH);
if (!fs.existsSync(ledgerDir)) {
    fs.mkdirSync(ledgerDir, { recursive: true });
}

/**
 * Generate a deterministic opportunity_id based on content
 * Excludes volatile fields like timestamps
 */
function generateOpportunityId(opp) {
    // Stable stringify of core fields
    const excludedKeys = new Set(['ts', 'timestamp', 'run_id', 'created_at', 'opportunity_id', 'id', 'rank_v2']);
    const keys = Object.keys(opp).filter(k => !excludedKeys.has(k)).sort();
    
    const stableObj = {};
    for (const k of keys) {
        stableObj[k] = opp[k];
    }
    
    const str = JSON.stringify(stableObj);
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Append opportunities to the ledger.
 * @param {string} run_id - The unique ID for this scan run
 * @param {Array} opportunities - List of opportunity objects
 * @returns {number} Number of records appended
 */
export function appendToLedger(run_id, opportunities) {
    if (!run_id || !opportunities || !Array.isArray(opportunities) || opportunities.length === 0) {
        return 0;
    }

    const ledgerDir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(ledgerDir)) {
        fs.mkdirSync(ledgerDir, { recursive: true });
    }

    const lines = opportunities.map(opp => {
        const detId = generateOpportunityId(opp);
        const entry = {
            id: detId,
            opportunity_id: detId, // Alias for query compatibility
            run_id: run_id,
            ts: new Date().toISOString(), // Ensure ts exists for since_ts queries
            source: opp.source || 'scan',
            ...opp,
            _ledger_ts: new Date().toISOString()
        };
        return JSON.stringify(entry);
    });

    try {
        fs.appendFileSync(LEDGER_PATH, lines.join('\n') + '\n', 'utf8');
        return lines.length;
    } catch (err) {
        console.error('[Ledger] Write failed:', err);
        return 0;
    }
}

/**
 * Query the ledger
 * @param {Object} params 
 * @returns {Object} result
 */
export function queryLedger(params = {}) {
    // Fail-fast limit check
    let limit = params.limit !== undefined ? parseInt(params.limit) : 20;
    if (isNaN(limit)) limit = 20;
    if (limit > 50) {
        throw new Error('Limit exceeds maximum allowed (50)');
    }

    const { run_id, since_ts, source } = params;
    
    if (!fs.existsSync(LEDGER_PATH)) {
        return { items: [], total_estimate: 0, next_cursor: null };
    }

    // Read file (Sync is okay for v0 minimal implementation)
    let content = '';
    try {
        content = fs.readFileSync(LEDGER_PATH, 'utf8');
    } catch (e) {
        return { items: [], total_estimate: 0, next_cursor: null };
    }

    const lines = content.split('\n');
    const items = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
            const record = JSON.parse(line);
            
            // Apply Filters
            if (run_id && record.run_id !== run_id) continue;
            if (since_ts && record.ts < since_ts) continue;
            if (source && record.source !== source) continue;
            
            items.push(record);
        } catch (e) {
            // Skip malformed lines
        }
    }
    
    // Apply Limit (return first N matches)
    const resultItems = items.slice(0, limit);
    
    return {
        items: resultItems,
        total_estimate: items.length,
        next_cursor: null
    };
}
