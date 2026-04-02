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

const LOW_VALUE_EVENTS = new Set(['RUNNER_TICK', 'BOT_TICK_OK', 'BOT_DECISION_GATED']);
const SUMMARY_PERIOD_MS = 5000;

export function createBotLogger(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries)) : 400;
  const logDir = options.logDir || resolve(__dirname, '..', '..', 'data', 'crypto_binary', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const ring = [];
  const summaryStateByKey = new Map();

  const getFilePath = (ts) => resolve(logDir, `bot_${ts.slice(0, 10)}.jsonl`);

  const writeEntry = (normalized) => {
    ring.push(normalized);
    if (ring.length > maxEntries) {
      ring.splice(0, ring.length - maxEntries);
    }
    appendFileSync(getFilePath(normalized.ts), `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
  };

  const flushSummaryIfDue = (normalized) => {
    const nowMs = Date.parse(normalized.ts);
    if (!Number.isFinite(nowMs)) return null;
    const key = `${normalized.source}`;
    const state = summaryStateByKey.get(key) || {
      lastFlushMs: nowMs,
      counts: { RUNNER_TICK: 0, BOT_TICK_OK: 0, BOT_DECISION_GATED: 0 },
      lastReason: null,
      lastWindowId: null
    };
    state.counts[normalized.event] = (state.counts[normalized.event] || 0) + 1;
    const reason = normalized?.data?.reason;
    if (typeof reason === 'string' && reason) state.lastReason = reason;
    if (normalized.window_id != null) state.lastWindowId = normalized.window_id;
    summaryStateByKey.set(key, state);
    if (nowMs - state.lastFlushMs < SUMMARY_PERIOD_MS) return null;
    const summary = normalizeEntry({
      level: 'info',
      source: normalized.source,
      event: 'BOT_TICK_SUMMARY',
      message: `tick summary ${SUMMARY_PERIOD_MS}ms`,
      mode: normalized.mode,
      window_id: state.lastWindowId ?? normalized.window_id,
      data: {
        period_ms: SUMMARY_PERIOD_MS,
        suppressed_total: (state.counts.RUNNER_TICK || 0) + (state.counts.BOT_TICK_OK || 0) + (state.counts.BOT_DECISION_GATED || 0),
        counts: { ...state.counts },
        last_reason: state.lastReason
      }
    });
    state.lastFlushMs = nowMs;
    state.counts = { RUNNER_TICK: 0, BOT_TICK_OK: 0, BOT_DECISION_GATED: 0 };
    state.lastReason = null;
    summaryStateByKey.set(key, state);
    return writeEntry(summary);
  };

  const flushPendingSummaries = (normalized) => {
    const out = [];
    for (const [key, state] of summaryStateByKey.entries()) {
      const suppressedTotal = (state.counts.RUNNER_TICK || 0) + (state.counts.BOT_TICK_OK || 0) + (state.counts.BOT_DECISION_GATED || 0);
      if (suppressedTotal <= 0) continue;
      const summary = normalizeEntry({
        level: 'info',
        source: key,
        event: 'BOT_TICK_SUMMARY',
        message: `tick summary ${SUMMARY_PERIOD_MS}ms`,
        mode: normalized.mode,
        window_id: state.lastWindowId ?? normalized.window_id,
        data: {
          period_ms: SUMMARY_PERIOD_MS,
          suppressed_total: suppressedTotal,
          counts: { ...state.counts },
          last_reason: state.lastReason
        }
      });
      state.counts = { RUNNER_TICK: 0, BOT_TICK_OK: 0, BOT_DECISION_GATED: 0 };
      state.lastReason = null;
      summaryStateByKey.set(key, state);
      out.push(writeEntry(summary));
    }
    return out;
  };

  const log = (entry = {}) => {
    const normalized = normalizeEntry(entry);
    if (LOW_VALUE_EVENTS.has(normalized.event)) {
      return flushSummaryIfDue(normalized);
    }
    if (normalized.event === 'BOT_STOPPED') {
      flushPendingSummaries(normalized);
    }
    return writeEntry(normalized);
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
