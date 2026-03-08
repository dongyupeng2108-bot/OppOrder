// tests/btcqdd_regime.test.mjs — regime_detector 三维度单元测试

import { createRegimeDetector } from '../strategies/crypto_binary/regime_detector.mjs';
import fs from 'fs';

const config = JSON.parse(
  fs.readFileSync('strategies/crypto_binary/instances/btc_15m_maker.json', 'utf8')
);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

function near(a, b, eps = 0.01) { return Math.abs(a - b) < eps; }

console.log('\n=== volumeScore 边界测试 ===');

{
  const d = createRegimeDetector(config);
  // volume_calm_ratio=1.5 → score=1.0
  assert(d.calcVolumeScore(1.5) === 1.0,  'volumeScore(1.5)=1.0（缩量边界）');
  assert(d.calcVolumeScore(1.0) === 1.0,  'volumeScore(1.0)=1.0（缩量）');
  assert(d.calcVolumeScore(0.5) === 1.0,  'volumeScore(0.5)=1.0（极低量）');
  // volume_surge_ratio=3.0 → score=0.0
  assert(d.calcVolumeScore(3.0) === 0.0,  'volumeScore(3.0)=0.0（放量边界）');
  assert(d.calcVolumeScore(5.0) === 0.0,  'volumeScore(5.0)=0.0（极高量）');
  // 中间线性：ratio=2.25（中点）→ score=0.5
  assert(near(d.calcVolumeScore(2.25), 0.5), `volumeScore(2.25)≈0.5: ${d.calcVolumeScore(2.25).toFixed(3)}`);
}

console.log('\n=== volumeScore 冷启动测试 ===');

{
  const d = createRegimeDetector(config);
  assert(d.calcVolumeScore(null)      === 0.5, 'volumeScore(null)=0.5（冷启动）');
  assert(d.calcVolumeScore(undefined) === 0.5, 'volumeScore(undefined)=0.5（冷启动）');
}

console.log('\n=== 三维度综合分数测试 ===');

{
  const d = createRegimeDetector(config);
  // 数据不足时三维度都返回中性（0.5），综合 score ≈ 0.5
  assert(near(d.getScore(), 0.5), `无数据时 score≈0.5: ${d.getScore().toFixed(3)}`);
}

{
  const d = createRegimeDetector(config);
  // 震荡条件：交替 outcome + 缩量
  ['UP', 'DOWN', 'UP', 'DOWN'].forEach(o => d.updateOutcome(o));
  d.updateVolumeRatio(1.0); // 缩量
  [0.3, 0.3, 0.3, 0.3].forEach(s => d.updateSigma(s)); // sigma 平稳
  const score = d.getScore();
  assert(score > 0.6, `震荡条件 score > 0.6: ${score.toFixed(3)}`);
}

{
  const d = createRegimeDetector(config);
  // 趋势条件：连续同向 + 放量
  ['UP', 'UP', 'UP', 'UP'].forEach(o => d.updateOutcome(o));
  d.updateVolumeRatio(4.0); // 放量
  [0.3, 0.5, 0.8, 1.2].forEach(s => d.updateSigma(s)); // sigma 加速
  const score = d.getScore();
  assert(score < 0.4, `趋势条件 score < 0.4: ${score.toFixed(3)}`);
}

console.log('\n=== updateVolumeRatio 接口测试 ===');

{
  const d = createRegimeDetector(config);
  d.updateVolumeRatio(2.0);
  const info = d.getDebugInfo();
  assert(info.latest_volume_ratio === 2.0,       'updateVolumeRatio 更新成功');
  assert(near(info.volume_score, 0.667, 0.01),   `volume_score(2.0)≈0.667: ${info.volume_score.toFixed(3)}`);
}

console.log('\n=== S2 激活区间验证（btc_15m_sniper.json）===');

{
  const sniper = JSON.parse(
    fs.readFileSync('strategies/crypto_binary/instances/btc_15m_sniper.json', 'utf8')
  );
  assert(sniper.regime.min_score === 0.6, `btc_15m_sniper regime.min_score=0.6: ${sniper.regime.min_score}`);
  assert(sniper.regime.max_score === 1.0, `btc_15m_sniper regime.max_score=1.0: ${sniper.regime.max_score}`);
}

console.log('\n=== 8 个实例 JSON 存在性验证 ===');

{
  const instances = [
    'btc_15m_maker_fix001', 'btc_15m_maker_fix002',
    'btc_15m_maker_fix003', 'btc_15m_maker_fix005',
    'btc_15m_maker_dyn_a',  'btc_15m_maker_dyn_b',
    'btc_15m_maker_dyn_c',  'btc_15m_sniper_v2',
  ];
  for (const id of instances) {
    const path = `strategies/crypto_binary/instances/${id}.json`;
    const exists = fs.existsSync(path);
    assert(exists, `${id}.json 存在`);
    if (exists) {
      const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
      assert(cfg.strategy_id === id,               `${id}.json strategy_id 正确`);
      assert(cfg.regime_detector?.sigma_weight === 0.33, `${id}.json regime_detector 三维度配置`);
    }
  }
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
