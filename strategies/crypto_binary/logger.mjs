// strategies/crypto_binary/logger.mjs

// 启动时从环境变量或 --log-level 参数读取级别
// 支持：debug / info / warn / error（默认 info）
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function getConfiguredLevel() {
  // 先查环境变量
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && LEVELS[envLevel] !== undefined) return envLevel;
  // 再查命令行参数 --log-level=debug
  const arg = process.argv.find(a => a.startsWith('--log-level='));
  if (arg) {
    const val = arg.split('=')[1].toLowerCase();
    if (LEVELS[val] !== undefined) return val;
  }
  return 'info';
}

const configuredLevel = getConfiguredLevel();

/**
 * 核心日志函数
 * @param {string} level - debug/info/warn/error
 * @param {string} event - 固定枚举事件名（见下方 EVENTS）
 * @param {object} fields - 可选附加字段
 */
function log(level, event, fields = {}) {
  if (LEVELS[level] < LEVELS[configuredLevel]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

// 便捷方法
export const logger = {
  debug: (event, fields) => log('debug', event, fields),
  info:  (event, fields) => log('info',  event, fields),
  warn:  (event, fields) => log('warn',  event, fields),
  error: (event, fields) => log('error', event, fields),
};

// 固定枚举事件名（只覆盖主链路）
export const EVENTS = {
  // 服务生命周期
  SERVER_START:               'server_start',
  SERVER_STOP:                'server_stop',

  // WebSocket 连接（Binance + Polymarket）
  WS_CONNECT_START:           'ws_connect_start',
  WS_CONNECT_OK:              'ws_connect_ok',
  WS_CONNECT_FAIL:            'ws_connect_fail',
  WS_DISCONNECT:              'ws_disconnect',
  WS_RECONNECT_SCHEDULED:     'ws_reconnect_scheduled',
  WS_RECONNECT_ATTEMPT:       'ws_reconnect_attempt',
  WS_RECONNECT_OK:            'ws_reconnect_ok',
  WS_RECONNECT_EXHAUSTED:     'ws_reconnect_exhausted',
  WS_MESSAGE_RECEIVED:        'ws_message_received',       // debug 级别
  WS_MESSAGE_DROPPED_STALE:   'ws_message_dropped_stale',  // 代际过期消息
  WS_PING_SENT:               'ws_ping_sent',              // debug 级别
  WS_PONG_TIMEOUT:            'ws_pong_timeout',

  // 窗口切换
  WINDOW_SWITCH_START:        'window_switch_start',
  WINDOW_SWITCH_COMMIT:       'window_switch_commit',
  WINDOW_SWITCH_ABORT:        'window_switch_abort',

  // 订阅管理
  SUBSCRIBE_START:            'subscribe_start',
  SUBSCRIBE_OK:               'subscribe_ok',
  SUBSCRIBE_FAIL:             'subscribe_fail',
  UNSUBSCRIBE:                'unsubscribe',

  // 下单/撤单关键入口
  ORDER_PLACE_SUBMIT:         'order_place_submit',
  ORDER_PLACE_ACK:            'order_place_ack',
  ORDER_PLACE_FAIL:           'order_place_fail',
  ORDER_CANCEL_SUBMIT:        'order_cancel_submit',
  ORDER_CANCEL_ACK:           'order_cancel_ack',
  ORDER_CANCEL_FAIL:          'order_cancel_fail',

  // 错误出口
  ERROR_UNHANDLED_PATH:       'error_unhandled_path',
  ERROR_PARSE_FAIL:           'error_parse_fail',
  ERROR_API_LIMIT:            'error_api_limit',
};
