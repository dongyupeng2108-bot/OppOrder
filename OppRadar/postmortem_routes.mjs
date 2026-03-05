/**
 * postmortem_routes.mjs
 * M6-A4 (260302_017): HTTP route handlers for postmortem endpoints.
 *
 * Endpoints:
 *   GET  /postmortem/pending        — outcomes without postmortem (limit, offset)
 *   GET  /postmortem/stats          — aggregated stats (group_by, time_range, strategy_id)
 *   GET  /postmortem/:opp_id        — full postmortem card (+ outcome + notes)
 *   POST /postmortem/:opp_id/note   — append a human note
 */

import { getPostmortem, getPostmortemWithOutcome, getNotes, insertNote } from './postmortem_store.mjs';
import { getStats } from './postmortem_stats.mjs';
import { listOutcomes } from './outcome_store.mjs';

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
 * GET /postmortem/pending
 * Returns outcomes that have no postmortem yet.
 */
async function handlePending(params, res) {
  const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);
  const offset = parseInt(params.get('offset') || '0', 10);

  const allOutcomes = listOutcomes();
  const pending = [];

  for (const oc of allOutcomes) {
    const pm = await getPostmortem(oc.opp_id);
    if (!pm) {
      pending.push({
        opp_id: oc.opp_id,
        title: oc.title || '',
        outcome: oc.outcome,
        settled_at: oc.settled_at,
        actual_price: oc.actual_price,
        recorded_at: oc.recorded_at,
      });
    }
  }

  const paginated = pending.slice(offset, offset + limit);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    items: paginated,
    total: pending.length,
    limit,
    offset,
  }));
}

/**
 * GET /postmortem/stats
 * Delegates to postmortem_stats.getStats().
 */
async function handleStats(params, res) {
  const result = await getStats({
    group_by: params.get('group_by') || undefined,
    time_range: params.get('time_range') || undefined,
    strategy_id: params.get('strategy_id') || undefined,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

/**
 * GET /postmortem/:opp_id
 * Returns full postmortem card with outcome + notes.
 */
async function handleGetCard(oppId, res) {
  const data = await getPostmortemWithOutcome(oppId);
  if (!data) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `postmortem not found for opp_id: ${oppId}` }));
    return;
  }

  const notes = await getNotes(oppId);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    postmortem: data.postmortem,
    outcome: data.outcome,
    notes: notes || [],
  }));
}

/**
 * POST /postmortem/:opp_id/note
 * Appends a human review note.
 */
async function handleAddNote(oppId, req, res) {
  const body = await parseBody(req);

  if (!body.note_text || typeof body.note_text !== 'string' || body.note_text.trim() === '') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'note_text is required and must be a non-empty string' }));
    return;
  }

  const result = await insertNote({
    opp_id: oppId,
    note_text: body.note_text.trim(),
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ opp_id: oppId, note_id: result.note_id }));
}

/**
 * Route dispatcher. Returns true if the request was handled, false otherwise.
 *
 * @param {string} pathname
 * @param {string} method
 * @param {URLSearchParams} params
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handlePostmortemRoute(pathname, method, params, req, res) {
  try {
    // GET /postmortem/pending
    if (pathname === '/postmortem/pending' && method === 'GET') {
      await handlePending(params, res);
      return true;
    }

    // GET /postmortem/stats (delegate — already has its own handler in 260302_016,
    // but we provide the canonical route here too)
    if (pathname === '/postmortem/stats' && method === 'GET') {
      await handleStats(params, res);
      return true;
    }

    // POST /postmortem/:opp_id/note
    if (pathname.startsWith('/postmortem/') && pathname.endsWith('/note') && method === 'POST') {
      const oppId = pathname.slice('/postmortem/'.length, -'/note'.length);
      if (!oppId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'opp_id is required' }));
        return true;
      }
      await handleAddNote(oppId, req, res);
      return true;
    }

    // GET /postmortem/:opp_id (must be after /pending, /stats, and before catch-all)
    if (pathname.startsWith('/postmortem/') && method === 'GET') {
      const oppId = pathname.slice('/postmortem/'.length);
      if (!oppId || oppId.includes('/')) return false;
      await handleGetCard(oppId, res);
      return true;
    }

    return false;
  } catch (err) {
    const status = err.message.startsWith('Invalid group_by') ? 400 : 500;
    console.error(`[postmortem_routes] ${pathname} error:`, err.message);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }
}
