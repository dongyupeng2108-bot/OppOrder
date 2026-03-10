// event_bus.mjs — 轻量事件总线，供各模块 publish 事件，供 WS 转发层 subscribe
import { EventEmitter } from 'events';
import { logger } from './logger.mjs';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export const EVENT_TYPES = {
  ORDER_PLACED:    'order.placed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_FILLED:    'order.filled',
  WINDOW_SWITCH:   'window.switch',
  REGIME_CHANGED:  'regime.changed',
};

export function publish(type, payload) {
  try {
    bus.emit('event', { type, payload, ts: Date.now() });
  } catch (e) {
    logger.error('event_bus_publish_fail', { module: 'event_bus', type, err: e.message });
  }
}

export function subscribe(handler) {
  bus.on('event', handler);
}

export function unsubscribe(handler) {
  bus.off('event', handler);
}
