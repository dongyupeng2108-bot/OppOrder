# TraeTask_260403_001 验收摘要（PM官方→单窗口→汇总→前端 分层定位）

## 结论块

- 样本：已采集 ≥2 个真实窗口（非 debug/audit 前缀）
- 唯一 first_break_layer：`window_rollup_count_basis`
- 说明：`last_7d` 包含今日已完成的真实窗口，但 `today` 汇总 `window_count=0`。官方层在当前环境不可用，单窗口层与汇总层可用。

## 四层对账（摘要）

- 官方结算真值层：
  - 当前环境无官方 PM 直连，`official_available=false`
  - 输出字段（占位）：`official_outcome`、`official_resolved_at` 为 `null`
- 单窗口结果层（两例）：
  - `btc-updown-5m-1775138700`：`filled_total=1, cancelled_total=0, realized=42.3986, completed_at=2026-04-02T14:09:41.423Z`
  - `btc-updown-5m-1775134200`：`filled_total=0, cancelled_total=0, realized=42.2692, completed_at=2026-04-02T12:50:44.239Z`
- 汇总统计层：
  - today：`window_count=0, filled_total=0, realized=0, included_windows=[]`
  - last_7d：`window_count=1478, filled_total=1776, realized=1494.9660...`（包含今日窗口 ID）
- 前端投影层：
  - 接口：`/bot/performance/summary?detail=1`
  - 字段：`window_count`、`filled_total`、`realized_gross_pnl_total`、`avg_realized_gross_pnl_per_window`
  - DOM：`se-perf-window-count`、`se-perf-realized-total`、`se-perf-avg-realized`

## 最小事实块

- PM官方 resolved（当前环境）：不可用（占位为空）
- 单窗口结果关键行：
  - `window_id=btc-updown-5m-1775138700, completed_at=2026-04-02T14:09:41.423Z, realized=42.3986`
  - `window_id=btc-updown-5m-1775134200, completed_at=2026-04-02T12:50:44.239Z, realized=42.2692`
- 今日统计关键行：`today.window_count=0, included_windows=[]`
- 7日统计关键行：`included_windows` 包含 `btc-updown-5m-1775138700` 等今日窗口
- 前端显示关键文本：消费 `/bot/performance/summary` 对应 DOM 字段（见上）

## 证据索引

- `rules/task-reports/2026-04/260403_001/260403_001_truth_audit_pm_stats_chain.json`
- `rules/task-reports/2026-04/260403_001/260403_001_truth_audit_pm_stats_chain.log`
- `rules/task-reports/2026-04/260403_001/260403_001_truth_audit_pm_stats_chain.heartbeat.log`
