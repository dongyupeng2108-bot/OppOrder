# truth_audit_260406_020

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 点差门限参数已生效，可在宽点差场景抑制劣质挂梯
- 治理结论: 参数化能力与审计证据口径一致

## 核查项
- [PASS] 低门限下宽点差触发 `spread_too_wide_for_entry`
- [PASS] 放宽门限后同类场景恢复 `ladder_not_posted` 路径
- [PASS] 配置更新接口支持 `max_spread_bps`
- [PASS] machine-readable truth_audit JSON 已产出
