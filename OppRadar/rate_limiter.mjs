/**
 * rate_limiter.mjs
 * M5.5-S3: Singleton rate limiter for API calls.
 *
 * Usage:
 *   import rateLimiter from './rate_limiter.mjs'
 *   const result = await rateLimiter.call('price', () => fetch(url))
 *
 * Exported as a singleton — all modules share the same instance.
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG = {
  max_requests_per_10s: 500,
  batch_interval_ms: 500,
  max_concurrent: 5,
  retry_max: 3,
  retry_backoff_base_ms: 1000,
};

let config = { ...DEFAULT_CONFIG };

// Try to load from scan profile
try {
  const profilePath = path.resolve(process.cwd(), 'config/scan_profiles/default.json');
  if (fs.existsSync(profilePath)) {
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (profile.rate_limiter) {
      config = { ...DEFAULT_CONFIG, ...profile.rate_limiter };
    }
  }
} catch (_) {}

let _activeCount = 0;
let _windowCalls = 0;
let _windowStart = Date.now();
let _sleepMs = 0;
let _apiCallsCount = 0;

// --- Trading buckets (independent per-bucket window tracking) ---
const BUCKET_DEFAULTS = {
  trading_order_post:   { limit: 3500, window_ms: 10000 },
  trading_order_delete: { limit: 3500, window_ms: 10000 },
  trading_order_get:    { limit: 3500, window_ms: 10000 },
};

const _bucketDefs = { ...BUCKET_DEFAULTS, ...(config.buckets || {}) };

// Per-bucket state: { calls, windowStart }
const _bucketState = new Map();
for (const name of Object.keys(_bucketDefs)) {
  _bucketState.set(name, { calls: 0, windowStart: Date.now() });
}

function _getBucketState(bucket) {
  if (!_bucketState.has(bucket)) {
    throw new Error(`Unknown rate limiter bucket: ${bucket}`);
  }
  return _bucketState.get(bucket);
}

function _getBucketDef(bucket) {
  if (!_bucketDefs[bucket]) {
    throw new Error(`Unknown rate limiter bucket: ${bucket}`);
  }
  return _bucketDefs[bucket];
}

function sleep(ms) {
  _sleepMs += ms;
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSlot() {
  // Wait for concurrency slot
  while (_activeCount >= config.max_concurrent) {
    await sleep(50);
  }

  // Check rate window (10s)
  const now = Date.now();
  if (now - _windowStart > 10000) {
    _windowCalls = 0;
    _windowStart = now;
  }

  if (_windowCalls >= config.max_requests_per_10s) {
    const waitTime = 10000 - (now - _windowStart) + 100;
    await sleep(waitTime);
    _windowCalls = 0;
    _windowStart = Date.now();
  }
}

const rateLimiter = {
  /**
   * Execute fn with rate limiting and retry.
   * @param {string} label - Label for logging
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} Result of fn
   */
  async call(label, fn) {
    await waitForSlot();

    _activeCount++;
    _windowCalls++;
    _apiCallsCount++;

    let lastErr;
    for (let attempt = 0; attempt <= config.retry_max; attempt++) {
      try {
        const result = await fn();
        _activeCount--;
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < config.retry_max) {
          const backoff = config.retry_backoff_base_ms * Math.pow(2, attempt);
          await sleep(backoff);
        }
      }
    }

    _activeCount--;
    throw lastErr;
  },

  getRateLimiterSleepMs() {
    return _sleepMs;
  },

  getApiCallsCount() {
    return _apiCallsCount;
  },

  reset() {
    _sleepMs = 0;
    _apiCallsCount = 0;
    _activeCount = 0;
    _windowCalls = 0;
    _windowStart = Date.now();
    for (const [, s] of _bucketState) {
      s.calls = 0;
      s.windowStart = Date.now();
    }
  },

  /**
   * Consume n tokens from a named bucket.
   * @param {string} bucket - Bucket name (e.g. 'trading_order_post')
   * @param {number} n - Number of tokens to consume
   */
  consume(bucket, n = 1) {
    const def = _getBucketDef(bucket);
    const st = _getBucketState(bucket);
    const now = Date.now();
    if (now - st.windowStart > def.window_ms) {
      st.calls = 0;
      st.windowStart = now;
    }
    st.calls += n;
  },

  /**
   * Check remaining tokens in a named bucket.
   * @param {string} bucket - Bucket name
   * @returns {number} Remaining tokens in current window
   */
  check(bucket) {
    const def = _getBucketDef(bucket);
    const st = _getBucketState(bucket);
    const now = Date.now();
    if (now - st.windowStart > def.window_ms) {
      st.calls = 0;
      st.windowStart = now;
    }
    return def.limit - st.calls;
  },

  /**
   * Execute fn with rate limiting against a named trading bucket.
   * @param {string} bucket - Bucket name
   * @param {string} label - Label for logging
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} Result of fn
   */
  async callBucket(bucket, label, fn) {
    const def = _getBucketDef(bucket);
    const st = _getBucketState(bucket);

    // Wait for concurrency slot (shared)
    while (_activeCount >= config.max_concurrent) {
      await sleep(50);
    }

    // Check bucket rate window
    const now = Date.now();
    if (now - st.windowStart > def.window_ms) {
      st.calls = 0;
      st.windowStart = now;
    }
    if (st.calls >= def.limit) {
      const waitTime = def.window_ms - (now - st.windowStart) + 100;
      await sleep(waitTime);
      st.calls = 0;
      st.windowStart = Date.now();
    }

    _activeCount++;
    st.calls++;
    _apiCallsCount++;

    let lastErr;
    for (let attempt = 0; attempt <= config.retry_max; attempt++) {
      try {
        const result = await fn();
        _activeCount--;
        return result;
      } catch (err) {
        lastErr = err;
        if (attempt < config.retry_max) {
          const backoff = config.retry_backoff_base_ms * Math.pow(2, attempt);
          await sleep(backoff);
        }
      }
    }

    _activeCount--;
    throw lastErr;
  },

  /** List all registered bucket names. */
  getBucketNames() {
    return Object.keys(_bucketDefs);
  },
};

export default rateLimiter;
