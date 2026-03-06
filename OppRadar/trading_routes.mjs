// M8-P6 | trading_routes.mjs

import { validateSignal } from './trading_signal.mjs';
import { processSignal } from './trading_order_engine.mjs';
import { executePaper } from './trading_executor_paper.mjs';
import { DB } from './db.mjs';
import * as killSwitch from './trading_kill_switch.mjs';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Register trading routes on the raw http server request handler.
 * Call from inside the http.createServer callback.
 * Returns true if a route was matched (response sent), false otherwise.
 */
export async function handleTradingRoute(req, res, pathname, query) {

  // POST /trading/signal
  if (pathname === '/trading/signal' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      validateSignal(body);
      const procResult = await processSignal(body);
      if (procResult.status === 'REJECTED') {
        return json(res, 200, {
          signal_id: body.signal_id,
          order_id: null,
          order_status: 'REJECTED',
          fill_status: null,
        });
      }
      // Fetch the created order
      const rows = await DB.allSql('SELECT * FROM trading_orders WHERE order_id = ?', [procResult.order_id]);
      const order = rows[0];
      const fillResult = await executePaper(order);
      return json(res, 200, {
        signal_id: body.signal_id,
        order_id: procResult.order_id,
        order_status: fillResult.status,
        fill_status: fillResult.status,
      });
    } catch (err) {
      if (err.message && (err.message.includes('is required') || err.message.includes('must be') || err.message.includes('invalid JSON'))) {
        return json(res, 400, { error: 'validation failed', detail: err.message });
      }
      return json(res, 500, { error: 'internal error', detail: err.message });
    }
  }

  // GET /trading/orders/:order_id
  if (pathname.startsWith('/trading/orders/') && pathname !== '/trading/orders' && req.method === 'GET') {
    const orderId = pathname.slice('/trading/orders/'.length);
    try {
      const orders = await DB.allSql('SELECT * FROM trading_orders WHERE order_id = ?', [orderId]);
      if (orders.length === 0) {
        return json(res, 404, { error: 'order not found' });
      }
      const order = orders[0];
      const fills = await DB.allSql('SELECT * FROM trading_fills WHERE order_id = ?', [orderId]);
      const snapshots = await DB.allSql('SELECT * FROM trading_snapshots WHERE order_id = ?', [orderId]);
      return json(res, 200, {
        order,
        fill: fills.length > 0 ? fills[0] : null,
        snapshot: snapshots.length > 0 ? snapshots[0] : null,
      });
    } catch (err) {
      return json(res, 500, { error: 'internal error', detail: err.message });
    }
  }

  // GET /trading/orders
  if (pathname === '/trading/orders' && req.method === 'GET') {
    try {
      const status = query.status || null;
      const opp_id = query.opp_id || null;
      let limit = parseInt(query.limit) || 50;
      if (limit > 200) limit = 200;
      const offset = parseInt(query.offset) || 0;

      let where = [];
      let params = [];
      if (status) { where.push('status = ?'); params.push(status); }
      if (opp_id) { where.push('opp_id = ?'); params.push(opp_id); }
      const whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';

      const countRows = await DB.allSql(`SELECT COUNT(*) as cnt FROM trading_orders${whereClause}`, params);
      const total = countRows[0]?.cnt || 0;
      const orders = await DB.allSql(
        `SELECT * FROM trading_orders${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return json(res, 200, { orders, total, limit, offset });
    } catch (err) {
      return json(res, 500, { error: 'internal error', detail: err.message });
    }
  }

  // POST /trading/kill
  if (pathname === '/trading/kill' && req.method === 'POST') {
    killSwitch.activate();
    const result = await killSwitch.cancelAllPending();
    return json(res, 200, {
      status: 'KILL_SWITCH_ACTIVATED',
      cancelled_orders: result.cancelled,
      message: 'Kill switch activated, all pending orders cancelled',
    });
  }

  return false; // no route matched
}
