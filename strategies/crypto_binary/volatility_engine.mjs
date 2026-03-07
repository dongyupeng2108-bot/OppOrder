// volatility_engine.mjs — 滚动窗口年化历史波动率
// 输入：收盘价数组（数字[]）、窗口期数、每年期数
// 输出：年化历史波动率 sigma（数字）

/**
 * 计算年化历史波动率
 * @param {number[]} closePrices - 收盘价序列（按时间升序，最新在末尾）
 * @param {number} windowPeriods - 使用最近 N 期计算
 * @param {number} periodsPerYear - 年化系数（15min K线 = 96*365 = 35040）
 * @returns {number} 年化历史波动率 sigma
 */
export function calcVolatility(closePrices, windowPeriods, periodsPerYear) {
  if (!closePrices || closePrices.length < 2) {
    throw new Error('calcVolatility: 需要至少 2 个收盘价');
  }

  // 取最近 windowPeriods + 1 个价格（计算 windowPeriods 个对数收益率）
  const prices = closePrices.slice(-(windowPeriods + 1));
  if (prices.length < 2) {
    throw new Error(`calcVolatility: 数据不足，需要 ${windowPeriods + 1} 个价格，实际 ${prices.length}`);
  }

  // 计算对数收益率序列
  const logReturns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0 || prices[i] <= 0) {
      throw new Error(`calcVolatility: 价格必须大于 0，发现 prices[${i-1}]=${prices[i-1]}, prices[${i}]=${prices[i]}`);
    }
    logReturns.push(Math.log(prices[i] / prices[i - 1]));
  }

  // 计算均值
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;

  // 计算样本方差（n-1）
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);

  // 年化标准差
  const sigma = Math.sqrt(variance * periodsPerYear);

  return sigma;
}
