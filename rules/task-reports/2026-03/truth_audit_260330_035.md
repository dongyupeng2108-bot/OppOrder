# TraeTask_260330_035 验收摘要（当前窗口标签来源修复）

## 结论块

- 结论：**通过（修复验收完成）**
- 修后唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复目标：`current_window_label_source` 已闭环

## 最小事实块

- UI 当前窗口标签原文与 API 对照（三时点）：
  - 启动后：
    - `label=April 1 8:45pm - 8:50pm`
    - `api_current_window_id=null`（允许回退）
  - 切窗后：
    - `label=April 1 8:50pm - 8:55pm`
    - `api_current_window_id=btc-updown-5m-1775091000`
  - 首次成交后：
    - `label=April 1 8:55pm - 9:00pm`
    - `api_current_window_id=btc-updown-5m-1775091300`
- 关键修复事实：
  - 标签来源表达式已改为 `currentWindowLabelSource`，且 `current_window_id` 为优先源
  - `source_uses_current_window_id_priority=true`
  - `labels_match_api_current_window_id=true`
- Fail -> Pass：
  - 修前（034）：`first_break_layer=current_window_label_source`，`pre_mismatch_observed=true`
  - 修后（035）：`first_break_layer=NONE_CHAIN_PASS`，`fail_to_pass.pass=true`

## 证据索引

- 修后主证据：
  - `rules/task-reports/2026-03/260330_035_truth_audit_current_window_label_fix.json`
  - `rules/task-reports/2026-03/260330_035_truth_audit_current_window_label_fix.log`
  - `rules/task-reports/2026-03/260330_035_truth_audit_current_window_label_fix.heartbeat.log`
- 修前对照：
  - `rules/task-reports/2026-03/260330_034_truth_audit_current_window_label_projection.json`
