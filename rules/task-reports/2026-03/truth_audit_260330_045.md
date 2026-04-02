# TraeTask_260330_045 验收摘要（显示精度收口）

## 结论块

- 结论：**通过（显示精度统一完成）**
- PNL 与 平均每窗口盈亏 已统一为小数点后 2 位。
- 仅改展示层格式化链，未改 API 原始值与计算逻辑。
- `first_break_layer=NONE_CHAIN_PASS`

## 最小事实块

- 修前 PNL 显示文本：
  - `42.39860412558299`（上一窗口 PNL）
  - `485.9`（近期表现摘要总计PNL）
- 修后 PNL 显示文本：
  - `42.40`
  - `485.92`
- 修前 平均每窗口盈亏 显示文本：
  - `5.58523249345317`
- 修后 平均每窗口盈亏 显示文本：
  - `5.59`
- 对应 API 原始数值（未改）：
  - `postmortem_realized_gross_pnl_total=42.39860412558299`
  - `summary_realized_gross_pnl_total=485.91522693042583`
  - `summary_avg_realized_gross_pnl_per_window=5.58523249345317`

## 证据索引

- `rules/task-reports/2026-03/260330_045_truth_audit_pnl_display_precision.json`
- `rules/task-reports/2026-03/260330_045_truth_audit_pnl_display_precision.log`
- `rules/task-reports/2026-03/260330_045_truth_audit_pnl_display_precision.heartbeat.log`
