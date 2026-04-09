import { randomUUID } from 'crypto';

const DEFAULT_PRICES = [0.27, 0.24, 0.21, 0.18];
const DEFAULT_SIZE = 5;
const DEFAULT_LADDER = DEFAULT_PRICES.map((price) => ({ price, size: DEFAULT_SIZE, tp_price: 1 }));
const DEFAULT_POST_MODE = 'resting_maker';

const cloneOrder = (order) => ({ ...order });
const extractWindowIdFromSource = (source) => {
  if (typeof source !== 'string' || source.length === 0) return null;
  const matched = source.match(/\|window=([a-zA-Z0-9._:-]+)/);
  return matched && matched[1] && matched[1] !== 'null' ? matched[1] : null;
};

const createOrder = ({ side, price, size, source, kind = 'ENTRY', tp_price = null, ladder_key = null, parent_order_id = null, window_id = null, post_mode = null, posted_price = null }) => ({
  order_id: `paper_${randomUUID().slice(0, 8)}`,
  kind,
  side,
  price,
  posted_price: Number.isFinite(posted_price) ? posted_price : price,
  size,
  tp_price,
  ladder_key,
  parent_order_id,
  window_id,
  post_mode: post_mode === 'immediate_taker' ? 'immediate_taker' : DEFAULT_POST_MODE,
  status: 'OPEN',
  fill_price: null,
  filled_at: null,
  created_at: new Date().toISOString(),
  source
});

const createExitFill = ({ side, price, size, source, window_id = null }) => {
  const ts = new Date().toISOString();
  return {
    order_id: `paper_${randomUUID().slice(0, 8)}`,
    kind: 'EXIT',
    side,
    price,
    size,
    window_id,
    status: 'FILLED',
    fill_price: price,
    filled_at: ts,
    created_at: ts,
    source
  };
};

export function createBotOrderLedger(options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  let orders = [];
  const emitChange = () => {
    if (!onChange) return;
    try {
      onChange({ summary: getSummary(), orders: getOrders() });
    } catch {}
  };
  const normalizeOrderSnapshot = (row) => {
    if (!row || typeof row !== 'object') return null;
    const side = row.side === 'NO' ? 'NO' : (row.side === 'YES' ? 'YES' : null);
    const kindRaw = typeof row.kind === 'string' ? row.kind : 'ENTRY';
    const kind = kindRaw === 'ENTRY' || kindRaw === 'TAKE_PROFIT' || kindRaw === 'EXIT' ? kindRaw : 'ENTRY';
    const price = Number(row.price);
    const size = Number(row.size);
    const statusRaw = typeof row.status === 'string' ? row.status : 'OPEN';
    const status = statusRaw === 'OPEN' || statusRaw === 'CANCELLED' || statusRaw === 'FILLED' ? statusRaw : 'OPEN';
    if (!side) return null;
    if (!Number.isFinite(price)) return null;
    if (!Number.isFinite(size) || size <= 0) return null;
    const tpRaw = row.tp_price;
    const tp = tpRaw === null || tpRaw === undefined || tpRaw === '' ? null : Number(tpRaw);
    const fillPriceRaw = row.fill_price;
    const fillPrice = fillPriceRaw === null || fillPriceRaw === undefined || fillPriceRaw === '' ? null : Number(fillPriceRaw);
    const postedPriceRaw = row.posted_price;
    const postedPrice = postedPriceRaw === null || postedPriceRaw === undefined || postedPriceRaw === '' ? null : Number(postedPriceRaw);
    const createdAt = typeof row.created_at === 'string' && row.created_at.length > 0 ? row.created_at : new Date().toISOString();
    const filledAt = typeof row.filled_at === 'string' && row.filled_at.length > 0 ? row.filled_at : null;
    const postMode = row.post_mode === 'immediate_taker' ? 'immediate_taker' : DEFAULT_POST_MODE;
    return {
      order_id: typeof row.order_id === 'string' && row.order_id.length > 0 ? row.order_id : `paper_${randomUUID().slice(0, 8)}`,
      kind,
      side,
      price,
      posted_price: Number.isFinite(postedPrice) ? postedPrice : price,
      size,
      tp_price: Number.isFinite(tp) ? tp : null,
      ladder_key: typeof row.ladder_key === 'string' && row.ladder_key.length > 0 ? row.ladder_key : null,
      parent_order_id: typeof row.parent_order_id === 'string' && row.parent_order_id.length > 0 ? row.parent_order_id : null,
      window_id: typeof row.window_id === 'string' && row.window_id.length > 0 ? row.window_id : null,
      post_mode: postMode,
      status,
      fill_price: Number.isFinite(fillPrice) ? fillPrice : null,
      filled_at: filledAt,
      created_at: createdAt,
      source: typeof row.source === 'string' && row.source.length > 0 ? row.source : 'snapshot'
    };
  };

  const getOrders = () => orders.map(cloneOrder);

  const getSummary = () => {
    const open = orders.filter(o => o.status === 'OPEN');
    const cancelled = orders.filter(o => o.status === 'CANCELLED');
    const filled = orders.filter(o => o.status === 'FILLED');
    return {
      total: orders.length,
      open_total: open.length,
      cancelled_total: cancelled.length,
      filled_total: filled.length,
      open_yes: open.filter(o => o.side === 'YES').length,
      open_no: open.filter(o => o.side === 'NO').length,
      filled_yes: filled.filter(o => o.side === 'YES').length,
      filled_no: filled.filter(o => o.side === 'NO').length
    };
  };

  const getFilledEntryOrders = (side) => orders.filter((order) => order.status === 'FILLED' && order.side === side && order.kind === 'ENTRY');
  const getFilledExitOrders = (side) => orders.filter((order) => order.status === 'FILLED' && order.side === side && (order.kind === 'EXIT' || order.kind === 'TAKE_PROFIT'));
  const getNetPositionSize = (side) => {
    const entrySize = getFilledEntryOrders(side).reduce((sum, order) => sum + (Number.isFinite(order.size) ? order.size : 0), 0);
    const exitSize = getFilledExitOrders(side).reduce((sum, order) => sum + (Number.isFinite(order.size) ? order.size : 0), 0);
    return Math.max(0, entrySize - exitSize);
  };

  const cancelOpenBySide = (side) => {
    let changed = 0;
    orders = orders.map((order) => {
      if (order.status === 'OPEN' && (side === 'ALL' || order.side === side)) {
        changed += 1;
        return { ...order, status: 'CANCELLED' };
      }
      return order;
    });
    return changed;
  };

  const placeBothLadders = (prices, size, source) => {
    const created = [];
    for (const price of prices) {
      created.push(createOrder({ side: 'YES', price, size, source }));
      created.push(createOrder({ side: 'NO', price, size, source }));
    }
    orders = [...orders, ...created];
    return created.length;
  };
  const normalizeLadder = (options = {}) => {
    if (Array.isArray(options.ladder) && options.ladder.length > 0) {
      const normalized = options.ladder.map((item) => {
        const price = Number(item?.price);
        const unitSize = Number(item?.size);
        const tpPriceRaw = item?.tp_price;
        const tpPrice = tpPriceRaw === null || tpPriceRaw === undefined || tpPriceRaw === '' ? 1 : Number(tpPriceRaw);
        if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
        if (!Number.isFinite(unitSize) || unitSize <= 0) return null;
        if (!Number.isFinite(tpPrice) || tpPrice <= 0 || tpPrice > 1) return null;
        return { price, size: unitSize, tp_price: tpPrice };
      }).filter(Boolean);
      if (normalized.length > 0) return normalized;
    }
    const prices = Array.isArray(options.prices) && options.prices.length ? options.prices : DEFAULT_PRICES;
    const size = Number.isFinite(options.size) ? options.size : DEFAULT_SIZE;
    return prices.map((price) => ({ price, size, tp_price: 1 }));
  };
  const placeSideLadder = (side, ladder, source, windowId = null, postMode = DEFAULT_POST_MODE) => {
    const created = ladder.map((item, index) => createOrder({
      side,
      price: item.price,
      posted_price: item.price,
      size: item.size,
      tp_price: item.tp_price,
      ladder_key: `${side}:${index}`,
      window_id: windowId,
      post_mode: postMode,
      source
    }));
    orders = [...orders, ...created];
    return created.length;
  };

  const applyFills = (context = {}) => {
    const askYes = Number.isFinite(context?.ask_yes) ? context.ask_yes : null;
    const askNo = Number.isFinite(context?.ask_no) ? context.ask_no : null;
    const bidYes = Number.isFinite(context?.bid_yes) ? context.bid_yes : null;
    const bidNo = Number.isFinite(context?.bid_no) ? context.bid_no : null;
    const currentWindowId = typeof context?.window_id === 'string' && context.window_id.length > 0
      ? context.window_id
      : null;
    const filledOrders = [];
    const tpOrdersToCreate = [];
    const blockedCrossWindowCandidates = [];
    const filledAt = new Date().toISOString();
    orders = orders.map((order) => {
      if (order.status !== 'OPEN' || order.kind === 'EXIT') return order;
      const candidateFillPrice = (
        order.kind === 'ENTRY' && order.side === 'YES' && askYes != null && order.price >= askYes
          ? askYes
          : (
            order.kind === 'ENTRY' && order.side === 'NO' && askNo != null && order.price >= askNo
              ? askNo
              : (
                order.kind === 'TAKE_PROFIT' && order.side === 'YES' && bidYes != null && bidYes >= order.price
                  ? order.price
                  : (
                    order.kind === 'TAKE_PROFIT' && order.side === 'NO' && bidNo != null && bidNo >= order.price
                      ? order.price
                      : null
                  )
              )
          )
      );
      const resolvedEntryFillPrice = (entryOrder, marketPrice) => {
        if (!Number.isFinite(marketPrice)) return null;
        if (entryOrder?.post_mode === 'immediate_taker') return marketPrice;
        const posted = Number.isFinite(entryOrder?.posted_price) ? entryOrder.posted_price : entryOrder?.price;
        return Number.isFinite(posted) ? posted : marketPrice;
      };
      const hasExplicitOrderWindow = typeof order?.window_id === 'string' && order.window_id.length > 0;
      const blockedCrossWindow = (
        currentWindowId != null
        && hasExplicitOrderWindow
        && order.window_id !== currentWindowId
      );
      if (blockedCrossWindow && candidateFillPrice != null) {
        blockedCrossWindowCandidates.push({
          order_id: order.order_id,
          kind: order.kind,
          side: order.side,
          order_price: order.price,
          candidate_fill_price: candidateFillPrice,
          order_window_id: order.window_id,
          current_window_id: currentWindowId
        });
        return order;
      }
      if (order.kind === 'ENTRY' && order.side === 'YES' && askYes != null && order.price >= askYes) {
        const fillPrice = resolvedEntryFillPrice(order, askYes);
        const nextOrder = { ...order, status: 'FILLED', fill_price: fillPrice, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        if (Number.isFinite(order.tp_price) && order.tp_price < 1) {
          tpOrdersToCreate.push(createOrder({
            side: 'YES',
            kind: 'TAKE_PROFIT',
            price: order.tp_price,
            size: order.size,
            tp_price: order.tp_price,
            window_id: order.window_id ?? null,
            source: `${order.source || 'runner_tick'}:tp`,
            ladder_key: order.ladder_key,
            parent_order_id: order.order_id
          }));
        }
        return nextOrder;
      }
      if (order.kind === 'ENTRY' && order.side === 'NO' && askNo != null && order.price >= askNo) {
        const fillPrice = resolvedEntryFillPrice(order, askNo);
        const nextOrder = { ...order, status: 'FILLED', fill_price: fillPrice, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        if (Number.isFinite(order.tp_price) && order.tp_price < 1) {
          tpOrdersToCreate.push(createOrder({
            side: 'NO',
            kind: 'TAKE_PROFIT',
            price: order.tp_price,
            size: order.size,
            tp_price: order.tp_price,
            window_id: order.window_id ?? null,
            source: `${order.source || 'runner_tick'}:tp`,
            ladder_key: order.ladder_key,
            parent_order_id: order.order_id
          }));
        }
        return nextOrder;
      }
      if (order.kind === 'TAKE_PROFIT' && order.side === 'YES' && bidYes != null && bidYes >= order.price) {
        const nextOrder = { ...order, status: 'FILLED', fill_price: order.price, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        return nextOrder;
      }
      if (order.kind === 'TAKE_PROFIT' && order.side === 'NO' && bidNo != null && bidNo >= order.price) {
        const nextOrder = { ...order, status: 'FILLED', fill_price: order.price, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        return nextOrder;
      }
      return order;
    });
    if (tpOrdersToCreate.length > 0) {
      orders = [...orders, ...tpOrdersToCreate];
    }
    if (filledOrders.length > 0 || tpOrdersToCreate.length > 0) {
      emitChange();
    }
    return {
      changed: filledOrders.length + tpOrdersToCreate.length,
      filled_orders: filledOrders,
      blocked_cross_window_candidates: blockedCrossWindowCandidates,
      summary: getSummary(),
      orders: getOrders()
    };
  };

  const getPaperSummary = (context = {}) => {
    const toSideSummary = (side, markPrice) => {
      const filledEntries = getFilledEntryOrders(side);
      const filledExits = getFilledExitOrders(side);
      const netPositionSize = getNetPositionSize(side);
      const entrySize = filledEntries.reduce((sum, order) => sum + (Number.isFinite(order.size) ? order.size : 0), 0);
      const filledNotional = filledEntries.reduce((sum, order) => {
        const fillPrice = Number.isFinite(order.fill_price) ? order.fill_price : null;
        const size = Number.isFinite(order.size) ? order.size : 0;
        if (fillPrice == null) return sum;
        return sum + (fillPrice * size);
      }, 0);
      const avgFillPrice = entrySize > 0 ? filledNotional / entrySize : null;
      const realizedGrossPnl = avgFillPrice == null
        ? 0
        : filledExits.reduce((sum, order) => {
            const fillPrice = Number.isFinite(order.fill_price) ? order.fill_price : null;
            const size = Number.isFinite(order.size) ? order.size : 0;
            if (fillPrice == null || size <= 0) return sum;
            return sum + ((fillPrice - avgFillPrice) * size);
          }, 0);
      if (filledEntries.length === 0 || netPositionSize <= 0) {
        return {
          entry_filled_count: filledEntries.length,
          exit_count: filledExits.length,
          position_size: 0,
          avg_fill_price: null,
          unrealized_gross_pnl: 0,
          realized_gross_pnl: realizedGrossPnl
        };
      }
      if (!Number.isFinite(markPrice)) {
        return {
          entry_filled_count: filledEntries.length,
          exit_count: filledExits.length,
          position_size: netPositionSize,
          avg_fill_price: avgFillPrice,
          unrealized_gross_pnl: null,
          realized_gross_pnl: realizedGrossPnl
        };
      }
      const pnl = avgFillPrice == null ? 0 : (markPrice - avgFillPrice) * netPositionSize;
      return {
        entry_filled_count: filledEntries.length,
        exit_count: filledExits.length,
        position_size: netPositionSize,
        avg_fill_price: avgFillPrice,
        unrealized_gross_pnl: pnl,
        realized_gross_pnl: realizedGrossPnl
      };
    };

    const bidYes = Number.isFinite(context?.bid_yes) ? context.bid_yes : null;
    const bidNo = Number.isFinite(context?.bid_no) ? context.bid_no : null;
    const yes = toSideSummary('YES', bidYes);
    const no = toSideSummary('NO', bidNo);
    const totalUnrealized = yes.unrealized_gross_pnl == null || no.unrealized_gross_pnl == null
      ? null
      : yes.unrealized_gross_pnl + no.unrealized_gross_pnl;
    const totalRealizedGross = yes.realized_gross_pnl + no.realized_gross_pnl;
    const filledTotal = yes.entry_filled_count + yes.exit_count + no.entry_filled_count + no.exit_count;
    return {
      yes_entry_filled_count: yes.entry_filled_count,
      yes_exit_filled_count: yes.exit_count,
      yes_position_size: yes.position_size,
      yes_avg_fill_price: yes.avg_fill_price,
      yes_realized_gross_pnl: yes.realized_gross_pnl,
      yes_unrealized_gross_pnl: yes.unrealized_gross_pnl,
      no_entry_filled_count: no.entry_filled_count,
      no_exit_filled_count: no.exit_count,
      no_position_size: no.position_size,
      no_avg_fill_price: no.avg_fill_price,
      no_realized_gross_pnl: no.realized_gross_pnl,
      no_unrealized_gross_pnl: no.unrealized_gross_pnl,
      filled_total: filledTotal,
      realized_gross_pnl_total: totalRealizedGross,
      unrealized_gross_pnl_total: totalUnrealized,
      updated_at: new Date().toISOString()
    };
  };

  const applyAction = (action, options = {}) => {
    const prices = Array.isArray(options.prices) && options.prices.length ? options.prices : DEFAULT_PRICES;
    const size = Number.isFinite(options.size) ? options.size : DEFAULT_SIZE;
    const ladder = normalizeLadder({ ladder: options.ladder, prices, size }) || DEFAULT_LADDER;
    const source = options.source || 'manual';
    const postMode = options.post_mode === 'immediate_taker' ? 'immediate_taker' : DEFAULT_POST_MODE;
    const windowId = typeof options.window_id === 'string' && options.window_id.length > 0
      ? options.window_id
      : extractWindowIdFromSource(source);
    let changed = 0;
    if (action === 'PLACE_BOTH_LADDERS') {
      changed = placeSideLadder('YES', ladder, source, windowId, postMode) + placeSideLadder('NO', ladder, source, windowId, postMode);
    }
    if (action === 'PLACE_YES_LADDER') changed = placeSideLadder('YES', ladder, source, windowId, postMode);
    if (action === 'PLACE_NO_LADDER') changed = placeSideLadder('NO', ladder, source, windowId, postMode);
    if (action === 'CANCEL_NO_OPEN') changed = cancelOpenBySide('NO');
    if (action === 'CANCEL_YES_OPEN') changed = cancelOpenBySide('YES');
    if (action === 'CANCEL_ALL_OPEN') changed = cancelOpenBySide('ALL');
    if (action === 'FLATTEN_YES_POSITION') {
      const positionSize = getNetPositionSize('YES');
      if (positionSize > 0) {
        const exitPrice = Number.isFinite(options.price) ? options.price : Number.isFinite(options.bid_yes) ? options.bid_yes : Number.isFinite(options.mark_price) ? options.mark_price : null;
        if (exitPrice != null) {
          orders = [...orders, createExitFill({ side: 'YES', price: exitPrice, size: positionSize, source, window_id: windowId })];
          changed = 1;
        }
      }
    }
    if (action === 'FLATTEN_NO_POSITION') {
      const positionSize = getNetPositionSize('NO');
      if (positionSize > 0) {
        const exitPrice = Number.isFinite(options.price) ? options.price : Number.isFinite(options.bid_no) ? options.bid_no : Number.isFinite(options.mark_price_no) ? options.mark_price_no : null;
        if (exitPrice != null) {
          orders = [...orders, createExitFill({ side: 'NO', price: exitPrice, size: positionSize, source, window_id: windowId })];
          changed = 1;
        }
      }
    }
    if (changed > 0) {
      emitChange();
    }
    return {
      action,
      changed,
      summary: getSummary(),
      orders: getOrders()
    };
  };

  const reset = () => {
    orders = [];
    emitChange();
    return { summary: getSummary(), orders: getOrders() };
  };

  const restore = (snapshotOrders = []) => {
    const list = Array.isArray(snapshotOrders) ? snapshotOrders : [];
    const restored = [];
    const seen = new Set();
    for (const row of list) {
      const normalized = normalizeOrderSnapshot(row);
      if (!normalized) continue;
      if (seen.has(normalized.order_id)) continue;
      seen.add(normalized.order_id);
      restored.push(normalized);
    }
    orders = restored;
    emitChange();
    return { restored: restored.length, summary: getSummary(), orders: getOrders() };
  };

  return { getOrders, getSummary, getPaperSummary, applyAction, applyFills, reset, restore };
}

export const BOT_LEDGER_DEFAULTS = { prices: DEFAULT_PRICES, size: DEFAULT_SIZE };
