# truth_audit_260406_011

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: `/bot/runner/tick` 请求契约类型错误可稳定拦截并返回 400
- 治理结论: 口径一致，审计证据可机读

## 核查项
- [PASS] 无效 JSON 返回 400（`invalid json payload`）
- [PASS] `context_override.remaining_sec` 类型错误返回 400
- [PASS] `state_override.yes_order_ids` 类型错误返回 400
- [PASS] machine-readable truth_audit JSON 已产出
