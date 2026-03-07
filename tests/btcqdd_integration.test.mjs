// tests/btcqdd_integration.test.mjs — B1.5 端到端集成测试
// 验证 regime_detector → strategy_router → 策略激活/休眠的完整链路
// 不依赖网络

import { createRegimeDetector } from '../strategies/crypto_binary/regime_detector.mjs';
import { createStrategyRouter } from '../strategies/crypto_binary/strategy_router.mjs';
import { createOrderManager } from '../strategies/crypto_binary/order_manager.mjs';
import { createCancelEngine } from '../strategies/crypto_binary/cancel_engine.mjs';
import { createPairTracker } from '../strategies/crypto_binary/pair_tracker.mjs';
import { createMakerStrategy } from '../strategies/crypto_binary/maker_strategy.mjs';
import { createSniperStrategy } from '../strategies/crypto_binary/sniper_strategy.mjs';
import fs from 'fs';

const makerConfig  = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m_maker.json', 'utf8'));
const sniperConfig = JSON.parse(fs.readFileSync('strategies/crypto_binary/instances/btc_15m_sniper.json', 'utf8'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}`); failed++; }
}

const windowEnd = new Date(Date.now() + 300 * 1000);

// 震荡盘面快照（mid_up=0.70，在 price_zone_filter 允许区间）
const oscillatingSnapshot = {
  bid_up: 0.69, ask_up: 0.71, mid_up: 0.70,
  bid_down: 0.29, ask_down: 0.31, mid_down: 0.30,
  spread_up: 0.02, spread_down: 0.02,
  tick_size: 0.01, tick_size_changed: false,
  up_token_id: 'tok_up', down_token_id: 'tok_down',
};

// 极端价格快照（S2 触发条件）
const extremeSnapshot = {
  bid_up: 0.08, ask_up: 0.10, mid_up: 0.09,
  bid_down: 0.87, ask_down: 0.90, mid_down: 0.885,
  spread_up: 0.02, spread_down: 0.03,
  tick_size: 0.001, tick_size_changed: false,
  up_token_id: 'tok_up', down_token_id: 'tok_down',
};

console.log('\n=== regime_detector 测试 ===');

{
  const detector = createRegimeDetector(makerConfig);

  // 数据不足时返回中性值
  assert(Math.abs(detector.getScore() - 0.5) < 0.01, '数据不足时 score≈0.5');

  // 输入交替 outcome → 高 alternation_score → 高 score
  detector.updateOutcome('UP');
  detector.updateOutcome('DOWN');
  detector.updateOutcome('UP');
  detector.updateOutcome('DOWN');
  const score = detector.getScore();
  assert(score > 0.5, `交替 outcome → score > 0.5: ${score.toFixed(3)}`);
}

{
  const detector = createRegimeDetector(makerConfig);

  // 连续同向 outcome → 低 alternation_score → 低 score
  ['UP', 'UP', 'UP', 'UP'].forEach(o => detector.updateOutcome(o));
  const score = detector.getScore();
  assert(score < 0.5, `连续同向 → score < 0.5: ${score.toFixed(3)}`);
}

console.log('\n=== strategy_router 广播测试 ===');

{
  // 构造 maker + sniper 两个策略实例
  const makerMgr  = createOrderManager({ ...makerConfig, strategy: { ...makerConfig.strategy, order_tranches: 1, tranche_weights: [1.0] }, paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 } });
  const sniperMgr = createOrderManager({ ...sniperConfig, strategy: { ...sniperConfig.strategy, order_tranches: 1, tranche_weights: [1.0] }, paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 } });
  const makerCE   = createCancelEngine(makerConfig, makerMgr);
  const sniperCE  = createCancelEngine(sniperConfig, sniperMgr);
  const pt        = createPairTracker(makerConfig);

  const maker  = createMakerStrategy(makerConfig, { orderManager: makerMgr, pairTracker: pt, cancelEngine: makerCE });
  const sniper = createSniperStrategy(sniperConfig, { orderManager: sniperMgr, cancelEngine: sniperCE });

  const router = createStrategyRouter({ btc_15m_maker: maker, btc_15m_sniper: sniper });

  // score=0.7：maker 激活（[0.5,1.0]），sniper 休眠（[0.0,0.6]）
  const { results } = router.dispatch({ snapshot: oscillatingSnapshot, regime_score: 0.7, sigma: 0.3, windowEnd });
  const makerResult  = results.find(r => r.strategy_id === 'btc_15m_maker');
  const sniperResult = results.find(r => r.strategy_id === 'btc_15m_sniper');

  assert(makerResult  && !makerResult.actions[0].startsWith('SLEEP'),  `score=0.7: maker 激活`);
  assert(sniperResult && sniperResult.actions[0].startsWith('SLEEP'),  `score=0.7: sniper 休眠`);
}

{
  const makerMgr  = createOrderManager({ ...makerConfig, strategy: { ...makerConfig.strategy, order_tranches: 1, tranche_weights: [1.0] }, paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 } });
  const sniperMgr = createOrderManager({ ...sniperConfig, strategy: { ...sniperConfig.strategy, order_tranches: 1, tranche_weights: [1.0] }, paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 } });
  const makerCE   = createCancelEngine(makerConfig, makerMgr);
  const sniperCE  = createCancelEngine(sniperConfig, sniperMgr);
  const pt        = createPairTracker(makerConfig);

  const maker  = createMakerStrategy(makerConfig, { orderManager: makerMgr, pairTracker: pt, cancelEngine: makerCE });
  const sniper = createSniperStrategy(sniperConfig, { orderManager: sniperMgr, cancelEngine: sniperCE });
  const router = createStrategyRouter({ btc_15m_maker: maker, btc_15m_sniper: sniper });

  // score=0.3：maker 休眠（< 0.5），sniper 激活（<= 0.6）
  const { results } = router.dispatch({ snapshot: extremeSnapshot, regime_score: 0.3, sigma: 0.3, windowEnd });
  const makerResult  = results.find(r => r.strategy_id === 'btc_15m_maker');
  const sniperResult = results.find(r => r.strategy_id === 'btc_15m_sniper');

  assert(makerResult  && makerResult.actions[0].startsWith('SLEEP'),   `score=0.3: maker 休眠`);
  assert(sniperResult && !sniperResult.actions[0].startsWith('SLEEP'), `score=0.3: sniper 激活`);
}

console.log('\n=== router.resetAll 测试 ===');

{
  const makerMgr = createOrderManager({ ...makerConfig, strategy: { ...makerConfig.strategy, order_tranches: 1, tranche_weights: [1.0] }, paper: { fill_model: 'optimistic', fill_discount: 1.0, fill_delay_ms: 0 } });
  const makerCE  = createCancelEngine(makerConfig, makerMgr);
  const pt       = createPairTracker(makerConfig);
  const maker    = createMakerStrategy(makerConfig, { orderManager: makerMgr, pairTracker: pt, cancelEngine: makerCE });
  const router   = createStrategyRouter({ btc_15m_maker: maker });

  router.dispatch({ snapshot: oscillatingSnapshot, regime_score: 0.7, sigma: 0.3, windowEnd });
  router.resetAll();
  assert(makerMgr.getOpenOrders().length === 0, 'resetAll 后无 OPEN 挂单');
}

console.log('\n=== 新配置文件结构验证 ===');

{
  assert(makerConfig.strategy.type === 'pair_cost_maker',   'btc_15m_maker.json type 正确');
  assert(makerConfig.regime.min_score === 0.5,              'btc_15m_maker.json regime.min_score=0.5');
  assert(makerConfig.cancel.sigma_threshold === 0.30,       'btc_15m_maker.json cancel 字段存在');
  assert(sniperConfig.strategy.type === 'low_price_sniper', 'btc_15m_sniper.json type 正确');
  assert(sniperConfig.regime.max_score === 0.6,             'btc_15m_sniper.json regime.max_score=0.6');
  assert(sniperConfig.cancel.sigma_threshold === 0.30,      'btc_15m_sniper.json cancel 字段存在');
}

console.log(`\n=== 测试结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
