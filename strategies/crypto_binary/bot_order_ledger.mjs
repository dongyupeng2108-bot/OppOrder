import { randomUUID } from 'crypto';

const DEFAULT_PRICES = [0.27, 0.24, 0.21, 0.18];
const DEFAULT_SIZE = 5;

const cloneOrder = (order) => ({ ...order });

const createOrder = ({ side, price, size, source }) => ({
  order_id: `paper_${randomUUID().slice(0, 8)}`,
  side,
  price,
  size,
  status: 'OPEN',
  fill_price: null,
  filled_at: null,
  created_at: new Date().toISOString(),
  source
});

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

  const applyFills = (context = {}) => {
    const askYes = Number.isFinite(context?.ask_yes) ? context.ask_yes : null;
    const askNo = Number.isFinite(context?.ask_no) ? context.ask_no : null;
    const filledOrders = [];
    const filledAt = new Date().toISOString();
    orders = orders.map((order) => {
      if (order.status !== 'OPEN') return order;
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
    const filledYes = orders.filter((order) => order.status === 'FILLED' && order.side === 'YES');
    const filledNo = orders.filter((order) => order.status === 'FILLED' && order.side === 'NO');
    const toSideSummary = (filledOrders, markPrice) => {
      if (filledOrders.length === 0) {
        return {
          count: 0,
          position_size: 0,
          avg_fill_price: null,
          mark_price: Number.isFinite(markPrice) ? markPrice : null,
          unrealized_pnl: Number.isFinite(markPrice) ? 0 : null
        };
      }
      const positionSize = filledOrders.reduce((sum, order) => sum + (Number.isFinite(order.size) ? order.size : 0), 0);
      const filledNotional = filledOrders.reduce((sum, order) => {
        const fillPrice = Number.isFinite(order.fill_price) ? order.fill_price : null;
        const size = Number.isFinite(order.size) ? order.size : 0;
        if (fillPrice == null) return sum;
        return sum + (fillPrice * size);
      }, 0);
      const avgFillPrice = positionSize > 0 ? filledNotional / positionSize : null;
      if (!Number.isFinite(markPrice)) {
        return {
          count: filledOrders.length,
          position_size: positionSize,
          avg_fill_price: avgFillPrice,
          mark_price: null,
          unrealized_pnl: null
        };
      }
      const pnl = filledOrders.reduce((sum, order) => {
        const fillPrice = Number.isFinite(order.fill_price) ? order.fill_price : null;
        const size = Number.isFinite(order.size) ? order.size : 0;
        if (fillPrice == null) return sum;
        return sum + ((markPrice - fillPrice) * size);
      }, 0);
      return {
        count: filledOrders.length,
        position_size: positionSize,
        avg_fill_price: avgFillPrice,
        mark_price: markPrice,
        unrealized_pnl: pnl
      };
    };

    const bidYes = Number.isFinite(context?.bid_yes) ? context.bid_yes : null;
    const bidNo = Number.isFinite(context?.bid_no) ? context.bid_no : null;
    const yes = toSideSummary(filledYes, bidYes);
    const no = toSideSummary(filledNo, bidNo);
    const totalUnrealized = yes.unrealized_pnl == null || no.unrealized_pnl == null ? null : yes.unrealized_pnl + no.unrealized_pnl;
    return {
      yes_filled_count: yes.count,
      no_filled_count: no.count,
      yes_position_size: yes.position_size,
      no_position_size: no.position_size,
      yes_avg_fill_price: yes.avg_fill_price,
      no_avg_fill_price: no.avg_fill_price,
      yes_mark_price: yes.mark_price,
      no_mark_price: no.mark_price,
      yes_unrealized_pnl: yes.unrealized_pnl,
      no_unrealized_pnl: no.unrealized_pnl,
      total_unrealized_pnl: totalUnrealized,
      updated_at: new Date().toISOString()
    };
  };

  const applyAction = (action, options = {}) => {
    const prices = Array.isArray(options.prices) && options.prices.length ? options.prices : DEFAULT_PRICES;
    const size = Number.isFinite(options.size) ? options.size : DEFAULT_SIZE;
    const source = options.source || 'manual';
    let changed = 0;
    if (action === 'PLACE_BOTH_LADDERS') changed = placeBothLadders(prices, size, source);
    if (action === 'CANCEL_NO_OPEN') changed = cancelOpenBySide('NO');
    if (action === 'CANCEL_YES_OPEN') changed = cancelOpenBySide('YES');
    if (action === 'CANCEL_ALL_OPEN') changed = cancelOpenBySide('ALL');
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
