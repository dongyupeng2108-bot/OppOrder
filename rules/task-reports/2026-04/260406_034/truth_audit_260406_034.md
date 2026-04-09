# truth_audit_260406_034

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 方向撤单参数已限制为仅撤开仓单，平仓单不再被误撤
- 治理结论: ENTRY/TAKE_PROFIT/EXIT 撤单作用域边界明确

## 核查项
- [PASS] `CANCEL_*_OPEN` 仅对 `ENTRY` 生效
- [PASS] `TAKE_PROFIT` 在参数撤单后保持 OPEN（未被撤销）
- [PASS] `ENTRY` 在参数撤单后正常被撤销
- [PASS] machine-readable truth_audit JSON 已产出
