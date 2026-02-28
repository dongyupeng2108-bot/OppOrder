/**
 * cache_provider.mjs
 * File-based cache for LLM call results.
 * Cache key: SHA256(prompt) → data/llm_cache/<prompt_hash>.json
 * Used by llm_gateway in mode='cache'.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'llm_cache');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read a cached result by prompt hash.
 * @param {string} promptHash
 * @returns {{ result: object, meta: object, cached_at: string } | null}
 */
export function cacheGet(promptHash) {
    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `${promptHash}.json`);
    if (!fs.existsSync(cachePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

/**
 * Write a result to cache by prompt hash.
 * @param {string} promptHash
 * @param {object} result
 * @param {object} meta
 */
export function cacheSet(promptHash, result, meta) {
    ensureDir(CACHE_DIR);
    const cachePath = path.join(CACHE_DIR, `${promptHash}.json`);
    fs.writeFileSync(cachePath, JSON.stringify({ result, meta, cached_at: new Date().toISOString() }, null, 2));
}
