# truth_audit_260406_026

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 已确认“挂单缺口”存在展示侧与口径侧混合风险，不能直接判定为必然未挂单
- 治理结论: 已形成可机读定位证据，未执行修复

## 核查项
- [PASS] UI 关键日志筛选未覆盖部分不挂单原因
- [PASS] UI 默认日志拉取未使用后端 `event/window_id` 精准过滤
- [PASS] 后端已支持 `event/window_id` 过滤能力
- [PASS] 策略存在合法不挂单条件路径（并非每窗口无条件挂梯）
- [PASS] machine-readable truth_audit JSON 已产出
