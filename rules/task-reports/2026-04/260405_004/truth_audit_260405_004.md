# truth_audit_260405_004

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 结论: M1-A1 执行事件契约字段已落地并可观测

## 覆盖摘要
- BOT_INTENTS：检测到契约字段样本
- RUNNER_TICK：当前样本窗口内未出现，不阻断
- BOT_FILL：当前样本窗口内未出现，不阻断

## 核查项
- [PASS] `event_id` 可观测
- [PASS] `context_version` 可观测
- [PASS] `source_event_ts` 可观测
- [PASS] `window_id` 可观测
- [PASS] 不回退语义检查通过

## 证据索引
- 主证据 JSON：
  - `rules/task-reports/2026-04/260405_004_truth_audit_m1_a1_execution_contract_260405_004.json`
- 脚本运行日志：
  - `rules/task-reports/2026-04/260405_004_truth_audit_m1_a1_execution_contract_260405_004.log`
