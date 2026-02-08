import crypto from 'crypto';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map();

/**
 * Generate a normalized cache key based on request parameters.
 * @param {Object} params - { provider, topic_key, query, timespan, maxrecords }
 * @returns {string} SHA-256 hash of the normalized key string
 */
export function generateCacheKey(params) {
    // Normalize parameters to ensure consistent keys
    const p = {
        provider: params.provider || 'local',
        topic_key: params.topic_key || '',
        query: params.query || '',
        timespan: params.timespan || '1d',
        maxrecords: Number(params.maxrecords) || 20
    };

    // Create a deterministic string representation
    const keyString = `provider=${p.provider}|topic=${p.topic_key}|q=${p.query}|span=${p.timespan}|max=${p.maxrecords}`;
    
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
 * @param {Object} data - The data to cache (e.g., fetch stats, count)
 */
export function setInCache(key, data) {
    // We cache the summary/stats of the operation, not necessarily the full raw heavy payload 
    // if we want to be lightweight, but the requirement says:
    // "return last fetch summary (count, timestamp)"
    // The user requirement implies we return cached result to avoid external request.
    // "Directly return cached: true ... and return last fetch summary"
    // So we store the result structure that the API returns.
    
    cache.set(key, {
        data: data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });

    // Simple cleanup if cache gets too big (optional protection)
    if (cache.size > 1000) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
    }
}

export function clearCache() {
    cache.clear();
}
