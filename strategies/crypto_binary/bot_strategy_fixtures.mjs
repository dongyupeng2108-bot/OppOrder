export function getDecisionFixtures() {
  return [
    {
      id: 'PRE_OPEN_10S',
      label: '开盘前 10 秒内',
      context: { period: '5m', remaining_sec: 295, btc_price: null, upper_bound: null, lower_bound: null },
      state: { ladder_posted: false },
      expected: { reason: 'pre_open_or_open_not_10s', intents: [{ kind: 'NOOP' }] }
    },
    {
      id: 'OPEN_10S_LADDER_EMPTY',
      label: '开盘满 10 秒',
      context: { period: '5m', remaining_sec: 285, btc_price: null, upper_bound: null, lower_bound: null },
      state: { ladder_posted: false },
      expected: {
        reason: 'ladder_not_posted',
        intents: [{ kind: 'PLACE_LADDER', side: 'BOTH', prices: [0.27, 0.24, 0.21, 0.18], size: 5 }]
      }
    },
    {
      id: 'BREAK_UPPER_BOUND',
      label: '涨破上界',
      context: { period: '5m', remaining_sec: 200, btc_price: 101000, upper_bound: 100000, lower_bound: 99000 },
      state: { ladder_posted: true },
      expected: { reason: 'btc_price>=upper_bound', intents: [{ kind: 'CANCEL_OPEN', side: 'NO' }] }
    },
    {
      id: 'BREAK_LOWER_BOUND',
      label: '跌破下界',
      context: { period: '5m', remaining_sec: 200, btc_price: 98000, upper_bound: 100000, lower_bound: 99000 },
      state: { ladder_posted: true },
      expected: { reason: 'btc_price<=lower_bound', intents: [{ kind: 'CANCEL_OPEN', side: 'YES' }] }
    },
    {
      id: 'REMAINING_100S',
      label: '剩余 100 秒',
      context: { period: '5m', remaining_sec: 100, btc_price: null, upper_bound: null, lower_bound: null },
      state: { ladder_posted: true },
      expected: { reason: 'remaining_sec<=100', intents: [{ kind: 'CANCEL_OPEN', side: 'ALL' }] }
    }
  ];
}
