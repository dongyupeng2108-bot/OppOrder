/**
 * tracking_interface_v1.mjs
 * C2 stub — tracking interface for opportunity lifecycle monitoring.
 *
 * M6可在不修改此文件签名的前提下替换实现。
 * 当前为 stub 实现，返回固定结构。M6 阶段将接入真实跟踪数据源。
 *
 * Exports:
 *   getTrackingStatus(opp_id) → { status: "stub", message: "M6 接入点" }
 *   getTrackingHistory(opp_id) → { status: "stub", records: [] }
 */

/**
 * Get the current tracking status for an opportunity.
 * Stub: returns placeholder. M6 will replace with real implementation.
 *
 * @param {string} opp_id
 * @returns {{ status: string, message: string }}
 */
export function getTrackingStatus(opp_id) {
  return { status: 'stub', message: 'M6 接入点' };
}

/**
 * Get the tracking history for an opportunity.
 * Stub: returns empty records. M6 will replace with real implementation.
 *
 * @param {string} opp_id
 * @returns {{ status: string, records: object[] }}
 */
export function getTrackingHistory(opp_id) {
  return { status: 'stub', records: [] };
}
