import crypto from 'crypto';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map();

/**
 * Generate a normalized cache key based on request parameters.
 * @param {Object} params - Arbitrary request parameters
 * @returns {string} SHA-256 hash of the normalized JSON string
 */
export function generateCacheKey(params) {
    // 1. Sort keys to ensure deterministic order
    const sortedKeys = Object.keys(params).sort();
    
    // 2. Create normalized object
    const normalized = {};
    // Denoise: remove timestamp, run_id, and other transient fields that shouldn't affect cache key
    const ignoredKeys = new Set(['run_id', 'timestamp', '_', 't', 'force_refresh']);
    
    for (const key of sortedKeys) {
        if (ignoredKeys.has(key)) continue;
        normalized[key] = params[key];
    }
    
    // 3. JSON stringify
    const keyString = JSON.stringify(normalized);
    
    // 4. SHA256
    return crypto.createHash('sha256').update(keyString).digest('hex');
}

/**
 * Retrieve a value from the cache if it exists and hasn't expired.
 * @param {string} key - The cache key
 * @returns {Object|null} The cached data or null if not found/expired
 */
export function getFromCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }

    return entry.data;
}

/**
 * Store a value in the cache with a TTL.
 * @param {string} key - The cache key
 * @param {Object} data - The data to cache
 */
export function setInCache(key, data) {
    cache.set(key, {
        data: data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });

    // Simple cleanup if cache gets too big
    if (cache.size > 1000) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

export function clearCache() {
    cache.clear();
}
