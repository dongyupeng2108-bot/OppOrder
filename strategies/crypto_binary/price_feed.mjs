// 价格数据：Binance REST 轮询获取现货价 + 历史价格序列
// B0 阶段：工厂函数骨架，B1 实现完整逻辑

export function createPriceFeed(config) {
  const symbol = config.price_feed.symbol;
  const pollSec = config.price_feed.poll_sec;
  const klineInterval = config.price_feed.kline_interval;
  const klineLimit = config.price_feed.kline_limit;

  async function getCurrentPrice() {
    // TODO: B1 实现
    // GET https://api.binance.com/api/v3/ticker/price?symbol={symbol}
    throw new Error('price_feed.getCurrentPrice() not implemented (B1)');
  }

  async function getKlines() {
    // TODO: B1 实现
    // GET https://api.binance.com/api/v3/klines?symbol={symbol}&interval={klineInterval}&limit={klineLimit}
    throw new Error('price_feed.getKlines() not implemented (B1)');
  }

  return { getCurrentPrice, getKlines, symbol, pollSec };
}
