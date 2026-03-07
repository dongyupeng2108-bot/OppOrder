// regime_detector.mjs — 市场状态检测器
// 输出 regime_score（0~1）：0=强趋势，1=强震荡
// 两个维度加权求和：sigma_trend(0.5) + recent_alternation(0.5)

export function createRegimeDetector(config) {
  const sigmaWeight      = config.regime_detector?.sigma_trend_weight      ?? 0.5;
  const alternationWeight = config.regime_detector?.alternation_weight      ?? 0.5;
  const sigmaWindow      = config.regime_detector?.sigma_window             ?? 4;
  const alternationWindow = config.regime_detector?.alternation_window      ?? 4;

  const sigmaHistory    = []; // 最近 N 个 sigma 值
  const outcomeHistory  = []; // 最近 N 个窗口 outcome（'UP'|'DOWN'）

  /**
   * 更新 sigma 历史，计算 sigma_trend 维度分数
   * sigma 平稳 → 高分（震荡），sigma 加速 → 低分（趋势）
   */
  function updateSigma(sigma) {
    sigmaHistory.push(sigma);
    if (sigmaHistory.length > sigmaWindow) sigmaHistory.shift();
  }

  /**
   * 更新 outcome 历史（窗口结算后调用）
   * @param {'UP'|'DOWN'} outcome
   */
  function updateOutcome(outcome) {
    outcomeHistory.push(outcome);
    if (outcomeHistory.length > alternationWindow) outcomeHistory.shift();
  }

  /**
   * 计算 sigma_trend 分数（0~1）
   * 用最近窗口内 sigma 的变化率：变化小→高分，变化大→低分
   */
  function calcSigmaTrendScore() {
    if (sigmaHistory.length < 2) return 0.5; // 数据不足，中性
    const mean = sigmaHistory.reduce((a, b) => a + b, 0) / sigmaHistory.length;
    if (mean === 0) return 0.5;
    const variance = sigmaHistory.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / sigmaHistory.length;
    const cv = Math.sqrt(variance) / mean; // 变异系数
    // cv=0 → score=1（完全平稳），cv≥0.5 → score=0（剧烈波动）
    return Math.max(0, 1 - cv * 2);
  }

  /**
   * 计算 recent_alternation 分数（0~1）
   * UP/DOWN 交替越多→高分（震荡），连续同向→低分（趋势）
   */
  function calcAlternationScore() {
    if (outcomeHistory.length < 2) return 0.5;
    let alternations = 0;
    for (let i = 1; i < outcomeHistory.length; i++) {
      if (outcomeHistory[i] !== outcomeHistory[i - 1]) alternations++;
    }
    return alternations / (outcomeHistory.length - 1);
  }

  /**
   * 获取当前 regime_score（0~1）
   */
  function getScore() {
    const sigmaTrend    = calcSigmaTrendScore();
    const alternation   = calcAlternationScore();
    const score = sigmaWeight * sigmaTrend + alternationWeight * alternation;
    return Math.min(1, Math.max(0, score));
  }

  function getDebugInfo() {
    return {
      sigma_history: [...sigmaHistory],
      outcome_history: [...outcomeHistory],
      sigma_trend_score: calcSigmaTrendScore(),
      alternation_score: calcAlternationScore(),
      regime_score: getScore(),
    };
  }

  return { updateSigma, updateOutcome, getScore, getDebugInfo };
}
