# truth_audit_260405_007

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 结论: BOT_FILL 成交审计字段 `decision_price/current_window_id` 已补齐并可观测

## 覆盖摘要（real runtime）
- fill_events=2
- fills=4
- with_decision_price=4
- with_current_window_id=4

## 核查项
- [PASS] 有 real runtime fill 样本
- [PASS] 每条 fill 均含 `decision_price`
- [PASS] 每条 fill 均含 `current_window_id`
- [PASS] 不回退语义检查通过

## 证据索引
- 主证据 JSON：
  - `rules/task-reports/2026-04/260405_007_truth_audit_m1_a2_fill_audit_fields_260405_007.json`
- 脚本运行日志：
  - `rules/task-reports/2026-04/260405_007_truth_audit_m1_a2_fill_audit_fields_260405_007.log`
