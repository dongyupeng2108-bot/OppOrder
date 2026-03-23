import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const normalizeEntry = (entry = {}) => ({
  ts: new Date().toISOString(),
  level: entry.level || 'info',
  source: entry.source || 'bot',
  event: entry.event || 'LOG',
  message: entry.message || '',
  mode: entry.mode ?? null,
  window_id: entry.window_id ?? null,
  data: entry.data && typeof entry.data === 'object' ? entry.data : {}
});

export function createBotLogger(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries)) : 400;
  const logDir = options.logDir || resolve(__dirname, '..', '..', 'data', 'crypto_binary', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const ring = [];

  const getFilePath = (ts) => resolve(logDir, `bot_${ts.slice(0, 10)}.jsonl`);

  const log = (entry = {}) => {
    const normalized = normalizeEntry(entry);
    ring.push(normalized);
    if (ring.length > maxEntries) {
      ring.splice(0, ring.length - maxEntries);
    }
    appendFileSync(getFilePath(normalized.ts), `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  };

  const getRecentLogs = (limit = 200) => {
    const n = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200;
    return ring.slice(-n);
  };

  const clear = () => {
    ring.splice(0, ring.length);
  };

  const getCount = () => ring.length;

  return { log, getRecentLogs, clear, getCount, getLogDir: () => logDir };
}
