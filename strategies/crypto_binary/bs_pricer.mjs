// bs_pricer.mjs — Black-Scholes 二元期权定价
// 纯函数，不依赖任何全局状态

/**
 * 标准正态分布 CDF（Hart 近似，精度 ~1e-7）
 * @param {number} x
 * @returns {number}
 */
function normCDF(x) {
  // Abramowitz & Stegun 26.2.17
  const b1 =  0.319381530;
  const b2 = -0.356563782;
  const b3 =  1.781477937;
  const b4 = -1.821255978;
  const b5 =  1.330274429;
  const pp =  0.2316419;

  if (x >= 0) {
    const t = 1.0 / (1.0 + pp * x);
    const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    return 1.0 - pdf * (((((b5 * t + b4) * t) + b3) * t + b2) * t + b1) * t;
  } else {
    return 1.0 - normCDF(-x);
  }
}

/**
 * 计算 Black-Scholes 二元期权理论概率
 *
 * 公式：
 *   d2 = [ln(S/K) + (r - 0.5 * sigma^2) * T] / (sigma * sqrt(T))
 *   P(Up)   = N(d2)
 *   P(Down) = 1 - N(d2)
 *
 * @param {number} S     - 当前现货价（Binance）
 * @param {number} K     - 行权价（窗口开始价，优先 Polymarket strike_price）
 * @param {number} T     - 剩余时间（年化，单位：年）
 * @param {number} sigma - 年化历史波动率
 * @param {number} r     - 无风险利率（默认 0）
 * @returns {{ pUp: number, pDown: number, d2: number }}
 * @throws {Error} 参数无效时抛出
 */
export function calcBSPrices(S, K, T, sigma, r = 0) {
  if (S <= 0) throw new Error(`calcBSPrices: S 必须 > 0，实际 ${S}`);
  if (K <= 0) throw new Error(`calcBSPrices: K 必须 > 0，实际 ${K}`);
  if (T <= 0) throw new Error(`calcBSPrices: T 必须 > 0，实际 ${T}`);
  if (sigma <= 0) throw new Error(`calcBSPrices: sigma 必须 > 0，实际 ${sigma}`);

  const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const pUp = normCDF(d2);
  const pDown = 1 - pUp;

  return { pUp, pDown, d2 };
}
