# truth_audit_260406_006

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 无效 JSON 已从误报 500 修正为 400（3 个端点全覆盖）
- 治理结论: 未引入范围锁越界，证据链可机读

## 核查项
- [PASS] `/config/reload` 无效 JSON 返回 400
- [PASS] `/bot/config` 无效 JSON 返回 400
- [PASS] `/bot/start` 无效 JSON 返回 400
- [PASS] 错误信息稳定为 `invalid json payload`
- [PASS] machine-readable truth_audit JSON 已产出
