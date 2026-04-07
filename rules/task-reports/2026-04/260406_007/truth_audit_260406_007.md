# truth_audit_260406_007

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 非对象 JSON 载荷已在 3 个端点被稳定拒绝（400）
- 治理结论: 未引入范围锁越界，审计证据可机读

## 核查项
- [PASS] `/config/reload` 数组载荷返回 400
- [PASS] `/bot/config` 数组载荷返回 400
- [PASS] `/bot/start` 数组载荷返回 400
- [PASS] 错误信息稳定为 `invalid json payload type`
- [PASS] machine-readable truth_audit JSON 已产出
