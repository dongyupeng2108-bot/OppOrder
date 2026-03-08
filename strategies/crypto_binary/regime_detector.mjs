// regime_detector.mjs — 市场状态检测器（三维度）
// regime_score（0~1）：0=强趋势，1=强震荡
// 三个维度加权求和：
//   sigmaTrendScore(0.33) + alternationScore(0.33) + volumeScore(0.34)

export function createRegimeDetector(config) {
  const rd = config.regime_detector || {};

  const sigmaWeight      = rd.sigma_weight       ?? 0.33;
  const alternationWeight = rd.alternation_weight ?? 0.33;
  const volumeWeight     = rd.volume_weight       ?? 0.34;

  const sigmaWindow      = rd.sigma_window        ?? 8;
  const alternationWindow = rd.alternation_window ?? 4;

  const volumeCalmRatio  = rd.volume_calm_ratio   ?? 1.5;
  const volumeSurgeRatio = rd.volume_surge_ratio  ?? 3.0;

  const sigmaHistory   = [];  // 最近 N 个 sigma 值
  const outcomeHistory = [];  // 最近 N 个窗口 outcome（'UP'|'DOWN'）

  // 最新 volume_ratio（由外部通过 updateVolumeRatio 传入）
  let latestVolumeRatio = null;

  // ─── sigma_trend 维度 ────────────────────────────────────
  // sigma 平稳 → 高分（震荡），sigma 加速 → 低分（趋势）

  function updateSigma(sigma) {
    sigmaHistory.push(sigma);
    if (sigmaHistory.length > sigmaWindow) sigmaHistory.shift();
  }

  function calcSigmaTrendScore() {
    if (sigmaHistory.length < 2) return 0.5;
    const mean = sigmaHistory.reduce((a, b) => a + b, 0) / sigmaHistory.length;
    if (mean === 0) return 0.5;
    const variance = sigmaHistory.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / sigmaHistory.length;
    const cv = Math.sqrt(variance) / mean; // 变异系数
    // cv=0 → score=1（完全平稳），cv≥0.5 → score=0
    return Math.max(0, 1 - cv * 2);
  }

  // ─── alternation 维度 ────────────────────────────────────
  // UP/DOWN 交替越多 → 高分（震荡），连续同向 → 低分（趋势）

  function updateOutcome(outcome) {
    outcomeHistory.push(outcome);
    if (outcomeHistory.length > alternationWindow) outcomeHistory.shift();
  }

  function calcAlternationScore() {
    if (outcomeHistory.length < 2) return 0.5;
    let alternations = 0;
    for (let i = 1; i < outcomeHistory.length; i++) {
      if (outcomeHistory[i] !== outcomeHistory[i - 1]) alternations++;
    }
    return alternations / (outcomeHistory.length - 1);
  }

  // ─── volume 维度 ─────────────────────────────────────────
  // 缩量 → 高分（震荡），放量 → 低分（趋势）

  function updateVolumeRatio(ratio) {
    latestVolumeRatio = ratio;
  }

  function calcVolumeScore(ratio) {
    // 冷启动（无数据）→ 中性 0.5
    if (ratio === null || ratio === undefined) return 0.5;
    if (ratio <= volumeCalmRatio)  return 1.0;  // 缩量 → 震荡
    if (ratio >= volumeSurgeRatio) return 0.0;  // 放量 → 趋势
    // 线性插值
    return 1.0 - (ratio - volumeCalmRatio) / (volumeSurgeRatio - volumeCalmRatio);
  }

  // ─── 综合分数 ─────────────────────────────────────────────

  function getScore() {
    const s = calcSigmaTrendScore();
    const a = calcAlternationScore();
    const v = calcVolumeScore(latestVolumeRatio);
    const score = sigmaWeight * s + alternationWeight * a + volumeWeight * v;
    return Math.min(1, Math.max(0, score));
  }

  function getDebugInfo() {
    return {
      sigma_history:      [...sigmaHistory],
      outcome_history:    [...outcomeHistory],
      latest_volume_ratio: latestVolumeRatio,
      sigma_trend_score:   calcSigmaTrendScore(),
      alternation_score:   calcAlternationScore(),
      volume_score:        calcVolumeScore(latestVolumeRatio),
      regime_score:        getScore(),
    };
  }

  return {
    updateSigma,
    updateOutcome,
    updateVolumeRatio,
    getScore,
    getDebugInfo,
    // 向后兼容（旧代码可能直接调用这些）
    calcVolumeScore,
  };
}
