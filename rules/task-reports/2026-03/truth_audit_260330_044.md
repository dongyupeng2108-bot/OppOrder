# TraeTask_260330_044 验收摘要（上一窗口结果口径一致性修复）

## 结论块

- 结论：**通过（修复验收完成）**
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复目标达成：
  - 上一窗口结果不再命中 `filled=0 && cancelled=0 && realized!=0` 的异常行
  - 近期表现摘要聚合口径不回退

## 最小事实块

- 修前异常样本（来自043）：
  - `filled_total=0`
  - `cancelled_total=0`
  - `realized_gross_pnl_total=42.26921625018299`
- 修后上一窗口结果 DOM：
  - `已成交总数=0; 已撤单总数=0; PNL=0`
- 修后 `/bot/postmortem/latest` 关键字段：
  - `filled_total=0`
  - `cancelled_total=0`
  - `realized_gross_pnl_total=0`
- 修后 `/bot/performance/summary?detail=1` 关键字段：
  - `window_count=86`
  - `filled_total=427`
  - `realized_gross_pnl_total=443.51662280484294`
- 两条不回退：
  - recent summary 汇总与 participating rows 求和一致
  - 正常行（`filled_total>0`）在 participating rows 中仍可稳定被识别，口径未回退
- healthcheck（server改动附带）：
  - `GET / = 200`
  - `GET /pairs = 404`

## 证据索引

- `rules/task-reports/2026-03/260330_044_truth_audit_prev_result_basis_fix.json`
- `rules/task-reports/2026-03/260330_044_truth_audit_prev_result_basis_fix.log`
- `rules/task-reports/2026-03/260330_044_truth_audit_prev_result_basis_fix.heartbeat.log`
- 修前对照：`rules/task-reports/2026-03/260330_043_truth_audit_prev_result_summary_basis.json`
