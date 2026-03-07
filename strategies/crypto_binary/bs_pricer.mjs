// Black-Scholes 二元期权定价
// B0 阶段：函数骨架，B1 实现完整逻辑

function normCDF(x) {
  // TODO: B1 实现
  throw new Error('normCDF() not implemented (B1)');
}

/**
 * 计算 Black-Scholes 二元期权理论概率
 * @param {number} S - 当前现货价
 * @param {number} K - 行权价（窗口开始价）
 * @param {number} T - 剩余时间（年化）
 * @param {number} sigma - 年化历史波动率
 * @param {number} r - 无风险利率（默认 0）
 * @returns {{ pUp: number, pDown: number, d2: number }}
 */
export function calcBSPrices(S, K, T, sigma, r = 0) {
  // TODO: B1 实现
  // d2 = [ln(S/K) + (r - 0.5*sigma^2)*T] / (sigma*sqrt(T))
  // pUp = N(d2), pDown = 1 - pUp
  throw new Error('calcBSPrices() not implemented (B1)');
}
