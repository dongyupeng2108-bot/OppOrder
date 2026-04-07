# truth_audit_260406_027

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 关键日志对不挂单原因的可见性已增强，窗口级补拉已接入
- 治理结论: 展示链路与后端过滤能力对齐，降低“误判未挂单”风险

## 核查项
- [PASS] 关键日志筛选覆盖 `spread_too_wide_for_entry` 与 `ladder_not_posted` 相关 reason
- [PASS] 关键模式补拉 `window_id` 与 `RUNNER_TICK` 日志
- [PASS] 状态语句包含点差护栏阻断解释
- [PASS] machine-readable truth_audit JSON 已产出
