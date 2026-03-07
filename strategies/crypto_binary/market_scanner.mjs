// 市场发现：通过 Polymarket Gamma API 按 slug_prefix 找当前窗口
// B0 阶段：工厂函数骨架，B1 实现完整逻辑

export function createScanner(config) {
  const slugPrefix = config.market.slug_prefix;
  const windowMinutes = config.market.window_minutes;

  async function findCurrentWindow() {
    // TODO: B1 实现
    // GET /events?slug={slugPrefix}*
    // 返回 { event_id, up_token_id, down_token_id, window_start, window_end, strike_price }
    throw new Error('market_scanner.findCurrentWindow() not implemented (B1)');
  }

  return { findCurrentWindow, slugPrefix, windowMinutes };
}
