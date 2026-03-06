// M8-P1 | trading_signal_router.mjs
// Signal Router — receives Signal, forwards to Order Engine (stub until P2)
//
// Signal sources:
//   - B5 排序输出（OppRadar LLM 策略）
//   - signal_engine（BTCQDD 策略，未来扩展）
//   - 手动触发（POST /trading/signal，P6 实现）

import { validateSignal } from './trading_signal.mjs';

export class SignalRouter {
  constructor(orderEngine = null) {
    this.orderEngine = orderEngine;
  }

  async route(signal) {
    validateSignal(signal);

    if (this.orderEngine) {
      const result = await this.orderEngine.process(signal);
      console.log(`[SignalRouter] routed signal_id=${signal.signal_id} opp_id=${signal.opp_id} side=${signal.side}`);
      return result;
    }

    console.log(`[SignalRouter] stub: signal ${signal.signal_id} received`);
    console.log(`[SignalRouter] routed signal_id=${signal.signal_id} opp_id=${signal.opp_id} side=${signal.side}`);
    return { status: 'STUB', signal_id: signal.signal_id };
  }
}
