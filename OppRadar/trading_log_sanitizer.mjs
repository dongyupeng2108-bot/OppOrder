// S3 | trading_log_sanitizer.mjs | Log sanitization for trading pipeline

const SENSITIVE_KEYS = [
  'POLY-SIGNATURE', 'POLY-NONCE', 'POLY-TIMESTAMP', 'POLY-ADDRESS',
  'private_key', 'privateKey', 'api_secret', 'apiSecret',
  'secret', 'passphrase', 'headers', 'signed_payload'
];

const PRIVATE_KEY_PATTERN = /0x[0-9a-fA-F]{60,}/g;

/**
 * Deep-sanitize an object or string, replacing sensitive fields/patterns.
 * Returns a new object — never mutates the original.
 */
export function sanitize(input) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return input.replace(PRIVATE_KEY_PATTERN, '[REDACTED]');
  }

  if (Array.isArray(input)) {
    return input.map(item => sanitize(item));
  }

  if (typeof input === 'object') {
    const out = {};
    for (const key of Object.keys(input)) {
      if (SENSITIVE_KEYS.includes(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitize(input[key]);
      }
    }
    return out;
  }

  return input;
}

/**
 * Safe logging — sanitizes data before output.
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {*} [data]
 */
export function safeLog(level, message, data) {
  if (data !== undefined) {
    console[level](message, sanitize(data));
  } else {
    console[level](message);
  }
}

/**
 * Sanitize an Error — only expose message and name.
 * @param {Error} err
 * @returns {{ message: string, name: string }}
 */
export function sanitizeError(err) {
  return { message: err.message, name: err.name };
}
