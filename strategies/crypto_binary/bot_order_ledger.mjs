import { randomUUID } from 'crypto';

const DEFAULT_PRICES = [0.27, 0.24, 0.21, 0.18];
const DEFAULT_SIZE = 5;
const DEFAULT_LADDER = DEFAULT_PRICES.map((price) => ({ price, size: DEFAULT_SIZE }));

const cloneOrder = (order) => ({ ...order });

const createOrder = ({ side, price, size, source }) => ({
  order_id: `paper_${randomUUID().slice(0, 8)}`,
  kind: 'ENTRY',
  side,
  price,
  size,
  status: 'OPEN',
  fill_price: null,
  filled_at: null,
  created_at: new Date().toISOString(),
  source
});

const createExitFill = ({ side, price, size, source }) => {
  const ts = new Date().toISOString();
  return {
    order_id: `paper_${randomUUID().slice(0, 8)}`,
    kind: 'EXIT',
    side,
    price,
    size,
    status: 'FILLED',
    fill_price: price,
    filled_at: ts,
    created_at: ts,
    source
  };
};

export function createBotOrderLedger() {
  let orders = [];

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

  const getFilledEntryOrders = (side) => orders.filter((order) => order.status === 'FILLED' && order.side === side && order.kind !== 'EXIT');
  const getFilledExitOrders = (side) => orders.filter((order) => order.status === 'FILLED' && order.side === side && order.kind === 'EXIT');
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
        if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
        if (!Number.isFinite(unitSize) || unitSize <= 0) return null;
        return { price, size: unitSize };
      }).filter(Boolean);
      if (normalized.length > 0) return normalized;
    }
    const prices = Array.isArray(options.prices) && options.prices.length ? options.prices : DEFAULT_PRICES;
    const size = Number.isFinite(options.size) ? options.size : DEFAULT_SIZE;
    return prices.map((price) => ({ price, size }));
  };
  const placeSideLadder = (side, ladder, source) => {
    const created = ladder.map((item) => createOrder({
      side,
      price: item.price,
      size: item.size,
      source
    }));
    orders = [...orders, ...created];
    return created.length;
  };

  const applyFills = (context = {}) => {
    const askYes = Number.isFinite(context?.ask_yes) ? context.ask_yes : null;
    const askNo = Number.isFinite(context?.ask_no) ? context.ask_no : null;
    const filledOrders = [];
    const filledAt = new Date().toISOString();
    orders = orders.map((order) => {
      if (order.status !== 'OPEN' || order.kind === 'EXIT') return order;
      if (order.side === 'YES' && askYes != null && order.price >= askYes) {
        const nextOrder = { ...order, status: 'FILLED', fill_price: askYes, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        return nextOrder;
      }
      if (order.side === 'NO' && askNo != null && order.price >= askNo) {
        const nextOrder = { ...order, status: 'FILLED', fill_price: askNo, filled_at: filledAt };
        filledOrders.push(cloneOrder(nextOrder));
        return nextOrder;
      }
      return order;
    });
    return {
      changed: filledOrders.length,
      filled_orders: filledOrders,
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
    let changed = 0;
    if (action === 'PLACE_BOTH_LADDERS') {
      changed = placeSideLadder('YES', ladder, source) + placeSideLadder('NO', ladder, source);
    }
    if (action === 'PLACE_YES_LADDER') changed = placeSideLadder('YES', ladder, source);
    if (action === 'PLACE_NO_LADDER') changed = placeSideLadder('NO', ladder, source);
    if (action === 'CANCEL_NO_OPEN') changed = cancelOpenBySide('NO');
    if (action === 'CANCEL_YES_OPEN') changed = cancelOpenBySide('YES');
    if (action === 'CANCEL_ALL_OPEN') changed = cancelOpenBySide('ALL');
    if (action === 'FLATTEN_YES_POSITION') {
      const positionSize = getNetPositionSize('YES');
      if (positionSize > 0) {
        const exitPrice = Number.isFinite(options.price) ? options.price : Number.isFinite(options.bid_yes) ? options.bid_yes : Number.isFinite(options.mark_price) ? options.mark_price : null;
        if (exitPrice != null) {
          orders = [...orders, createExitFill({ side: 'YES', price: exitPrice, size: positionSize, source })];
          changed = 1;
        }
      }
    }
    if (action === 'FLATTEN_NO_POSITION') {
      const positionSize = getNetPositionSize('NO');
      if (positionSize > 0) {
        const exitPrice = Number.isFinite(options.price) ? options.price : Number.isFinite(options.bid_no) ? options.bid_no : Number.isFinite(options.mark_price_no) ? options.mark_price_no : null;
        if (exitPrice != null) {
          orders = [...orders, createExitFill({ side: 'NO', price: exitPrice, size: positionSize, source })];
          changed = 1;
        }
      }
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
    return { summary: getSummary(), orders: getOrders() };
  };

  return { getOrders, getSummary, getPaperSummary, applyAction, applyFills, reset };
}

export const BOT_LEDGER_DEFAULTS = { prices: DEFAULT_PRICES, size: DEFAULT_SIZE };
