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
  created_at: new Date().toISOString(),
  source
});

export function createBotOrderLedger() {
  let orders = [];

  const getOrders = () => orders.map(cloneOrder);

  const getSummary = () => {
    const open = orders.filter(o => o.status === 'OPEN');
    const cancelled = orders.filter(o => o.status === 'CANCELLED');
    return {
      total: orders.length,
      open_total: open.length,
      cancelled_total: cancelled.length,
      open_yes: open.filter(o => o.side === 'YES').length,
      open_no: open.filter(o => o.side === 'NO').length
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

  return { getOrders, getSummary, applyAction, reset };
}

export const BOT_LEDGER_DEFAULTS = { prices: DEFAULT_PRICES, size: DEFAULT_SIZE };
