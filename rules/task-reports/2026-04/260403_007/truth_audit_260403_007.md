## TraeTask_260403_007 验收摘要（today=0 定位）

### 结论块
- 结论：通过（定位完成，未修复业务逻辑）
- 唯一 first_break_layer：`completed_window_absent`
- 明确归因：主因是样本窗口仍未进入 completed/postmortem，因此 today 输入为空；前端为汇总直投，显示正常。

### 样本窗口（real runtime，13:59后）
- `btc-updown-5m-1775138400`
- `btc-updown-5m-1775138700`

### 四层对账结论
- PM官方结算层：
  - 样本窗口在汇总行中无显式 `official_resolved/resolved_at/final_outcome` 字段。
  - 关键事实：`official_resolved = null`（证据口径为“无官方字段可用”）。
- completed窗口层：
  - 两个样本均未出现 `postmortem` 行，`completed_at = null`。
  - 关键事实：`has_postmortem_row=false`，`today_exclusion_reason=not_completed_no_postmortem`。
- today纳入层：
  - `/bot/performance/summary?preset=today&detail=1` 当前 `window_count=0`，`participating_postmortem_rows=[]`。
  - 关键事实：today 输入集合为空。
- 前端投影层：
  - 文案由前端按汇总直投：`当前无已完成窗口数据（running 窗口不计入）`。
  - 关键事实：前端未自行计算 today，展示与汇总一致。

### 最小事实块
- PM官方 resolved 关键行：
  - 样本字段：`official_resolved=null`，`resolved_at=null`（审计 JSON 中样本层）
- completed/result 关键行：
  - 样本字段：`completed_at=null`，`has_postmortem_row=false`
- today 关键行：
  - `window_count=0`
  - `participating_postmortem_rows_count=0`
- 前端 DOM 关键文本：
  - `当前无已完成窗口数据（running 窗口不计入）`

### 证据索引
- `rules/task-reports/2026-04/260403_007/260403_007_truth_audit_today_chain.json`
- `rules/task-reports/2026-04/260403_007/260403_007_truth_audit_today_chain.log`
