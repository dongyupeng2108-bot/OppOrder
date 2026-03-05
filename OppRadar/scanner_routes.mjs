/**
 * scanner_routes.mjs
 * M5.5-S4 (260305_004): HTTP route handlers for scanner/universe endpoints.
 *
 * Endpoints:
 *   POST /scanner/run            — trigger a scanner run
 *   GET  /scanner/runs           — scanner run history
 *   GET  /universe/runs          — universe run history
 *   GET  /snapshots/core/:market_id — latest CoreSnapshot for a market
 */

import { runUniverse, getUniverseRuns } from './universe_service.mjs';
import { runScanner } from './scanner_service.mjs';
import { getScannerRuns, getLatestCoreSnapshot } from './snapshot_store.mjs';

/**
 * Parse JSON body from request.
 */
function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (_) { resolve({}); }
    });
  });
}

/**
 * POST /scanner/run
 * Trigger a scanner run (Universe + CoreSnapshot, no LLM).
 */
async function handleScannerRun(req, res) {
  try {
    const body = await parseBody(req);
    const specPath = body.universe_spec
      ? `config/universe_specs/${body.universe_spec}.json`
      : undefined;

    const universeRun = await runUniverse(specPath);
    const scannerRun = await runScanner({ universeRun });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      scanner_run_id: scannerRun.scanner_run_id,
      core_success_count: scannerRun.core_success_count,
      core_fail_count: scannerRun.core_fail_count,
      wall_time_ms: scannerRun.wall_time_ms,
    }));
  } catch (err) {
    console.error('[scanner_routes] POST /scanner/run error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * GET /scanner/runs
 */
async function handleScannerRuns(params, res) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 200);
  const offset = parseInt(params.get('offset') || '0', 10);

  const { runs, total } = await getScannerRuns(limit, offset);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ runs, total }));
}

/**
 * GET /universe/runs
 */
async function handleUniverseRuns(params, res) {
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 200);
  const offset = parseInt(params.get('offset') || '0', 10);

  const { runs, total } = await getUniverseRuns(limit, offset);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ runs, total }));
}

/**
 * GET /snapshots/core/:market_id
 */
async function handleCoreSnapshot(marketId, res) {
  const snap = await getLatestCoreSnapshot(marketId);
  if (!snap) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `CoreSnapshot not found for market_id: ${marketId}` }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(snap));
}

/**
 * Route dispatcher. Returns true if handled, false otherwise.
 */
export async function handleScannerRoute(pathname, method, params, req, res) {
  try {
    // POST /scanner/run
    if (pathname === '/scanner/run' && method === 'POST') {
      await handleScannerRun(req, res);
      return true;
    }

    // GET /scanner/runs
    if (pathname === '/scanner/runs' && method === 'GET') {
      await handleScannerRuns(params, res);
      return true;
    }

    // GET /universe/runs
    if (pathname === '/universe/runs' && method === 'GET') {
      await handleUniverseRuns(params, res);
      return true;
    }

    // GET /snapshots/core/:market_id
    if (pathname.startsWith('/snapshots/core/') && method === 'GET') {
      const marketId = pathname.slice('/snapshots/core/'.length);
      if (!marketId || marketId.includes('/')) return false;
      await handleCoreSnapshot(marketId, res);
      return true;
    }

    return false;
  } catch (err) {
    console.error(`[scanner_routes] ${pathname} error:`, err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }
}
