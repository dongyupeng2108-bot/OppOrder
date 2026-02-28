/**
 * llm_gateway.mjs
 * M3-T9: LLM Provider Gateway — cache + record + schema + fallback
 *
 * export async function callLLM({ prompt, model, mode, taskId, _schema })
 *
 * mode='mock'  → deterministic mock result, no I/O
 * mode='cache' → hit: return cached; miss: fallback to mock
 * mode='live'  → simulated live call, schema validation, record result, cache; fail → fallback to mock
 *
 * Returns: { result, meta: { provider_used, model_used, prompt_hash, fallback, cached } }
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { validateObject } from './validate_schema.mjs';
import { callMock } from './providers/mock_provider.mjs';
import { cacheGet, cacheSet } from './providers/cache_provider.mjs';
import { callLive } from './providers/live_provider.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RECORDS_DIR = path.join(PROJECT_ROOT, 'data', 'llm_records');
const SCHEMA_PATH = path.join(__dirname, 'contracts', 'opportunity_card.schema.json');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashPrompt(prompt) {
    return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/** Load opportunity card schema. Accepts _schema override for testing. */
function loadSchema(_schema) {
    if (_schema) return _schema;
    try {
        return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    } catch (e) {
        // Minimal fallback schema
        return {
            required: ['id', 'title', 'score', 'run_id', 'created_at'],
            properties: {
                score: { type: 'number', minimum: 0, maximum: 1 }
            }
        };
    }
}

/** Write schema validation failure evidence. */
function recordSchemaFail({ prompt_hash, mode, errors, result }) {
    ensureDir(RECORDS_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const failRecord = {
        timestamp: new Date().toISOString(),
        prompt_hash,
        mode,
        errors,
        result
    };
    fs.writeFileSync(
        path.join(RECORDS_DIR, `schema_fail_${timestamp}.json`),
        JSON.stringify(failRecord, null, 2)
    );
}

/**
 * Call LLM via Gateway.
 *
 * @param {object} opts
 * @param {string} opts.prompt       - Input prompt
 * @param {string} [opts.model]      - Model name (default: 'mock-v1')
 * @param {string} [opts.mode]       - 'mock' | 'cache' | 'live' (default: 'mock')
 * @param {string} [opts.taskId]     - Task ID for audit trail
 * @param {object} [opts._schema]    - Schema override (for testing schema-fail path)
 * @returns {Promise<{ result: object, meta: object }>}
 */
export async function callLLM({ prompt, model = 'mock-v1', mode = 'mock', taskId = 'unknown', _schema = null }) {
    ensureDir(RECORDS_DIR);

    const prompt_hash = hashPrompt(prompt);
    const schema = loadSchema(_schema);

    const meta = {
        provider_used: mode,
        model_used: model,
        prompt_hash,
        fallback: false,
        cached: false
    };

    // ── mock ─────────────────────────────────────────────────────────────
    if (mode === 'mock') {
        const result = await callMock({ prompt, model });
        meta.provider_used = 'mock';
        return { result, meta };
    }

    // ── cache ─────────────────────────────────────────────────────────────
    if (mode === 'cache') {
        const cached = cacheGet(prompt_hash);
        if (cached) {
            meta.cached = true;
            meta.provider_used = cached.meta?.provider_used || 'cache';
            return { result: cached.result, meta };
        }
        // Cache miss → fallback to mock
        meta.fallback = true;
        meta.provider_used = 'mock';
        const result = await callMock({ prompt, model });
        return { result, meta };
    }

    // ── live ──────────────────────────────────────────────────────────────
    if (mode === 'live') {
        let liveResult;
        try {
            liveResult = await callLive({ prompt, model });
        } catch (e) {
            // Live call threw → fallback to mock
            meta.fallback = true;
            meta.provider_used = 'mock';
            const result = await callMock({ prompt, model });
            return { result, meta };
        }

        // Schema validation
        const validation = validateObject(liveResult, schema);
        if (!validation.valid) {
            // Record schema failure evidence
            recordSchemaFail({ prompt_hash, mode: 'live', errors: validation.errors, result: liveResult });
            // Fallback to mock
            meta.fallback = true;
            meta.provider_used = 'mock';
            const result = await callMock({ prompt, model });
            return { result, meta };
        }

        // Record successful live call
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(
            path.join(RECORDS_DIR, `record_${timestamp}.json`),
            JSON.stringify({
                timestamp: new Date().toISOString(),
                prompt_hash,
                task_id: taskId,
                result: liveResult,
                meta: { ...meta, provider_used: 'live' }
            }, null, 2)
        );

        // Cache the live result
        cacheSet(prompt_hash, liveResult, { ...meta, provider_used: 'live' });

        meta.provider_used = 'live';
        return { result: liveResult, meta };
    }

    // Unknown mode → fallback to mock
    meta.fallback = true;
    meta.provider_used = 'mock';
    const result = await callMock({ prompt, model });
    return { result, meta };
}
