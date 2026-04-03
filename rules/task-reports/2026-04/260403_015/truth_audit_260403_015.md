## TraeTask_260403_015 验收摘要（today 胜率/PNL 失真定位）

### 结论块
- 结论：已定位
- 唯一 first_break_layer：`postmortem_result_snapshot_scope_mismatch`
- 归因层：`postmortem/result 生成层`

### today UI / API 当前值（审计快照）
- `window_count=85`
- `win_rate=100.0%`
- `filled_total=88`
- `realized_gross_pnl_total=3570.8729577281724`
- `avg_realized_gross_pnl_per_window=42.010270090919676`

### participating_postmortem_rows 与手算
- 参与集合：85 行（脚本输出前 20 行）
- 手算：
  - `Σ realized_gross_pnl_total = 3570.8729577281724`
  - `win_numerator=85`
  - `win_denominator=85`
  - `win_rate=100.0%`
- 与 summary 返回逐项一致：`window_count/filled_total/cancelled_total/pnl/avg` 全匹配

### 关键异常
- 存在多行：
  - `filled_total=0`
  - `cancelled_total=0`
  - `realized_gross_pnl_total>0`（约 `42.x`）
- 这类行被纳入胜率分子与 PNL 累加，直接推动 100% 胜率与高 PNL。

### 订单真值抽样（3 窗口）
- 高盈利样本（row pnl=42.07807663910079）：
  - 真值 `filled_total_truth=2`，`realized_gross_pnl_total_truth=0`
- 零成交异常样本（row pnl=42.07501097522348）：
  - 真值 `filled_total_truth=0`，`realized_gross_pnl_total_truth=0`
- 普通成交样本（row pnl=42.07501097522348）：
  - 真值 `filled_total_truth=1`，`realized_gross_pnl_total_truth=0`

### 直接原因判定
- UI 层：直投接口，不是首断层。
- summary 聚合层：与参与行手算一致，不是首断层。
- 首断层在 postmortem/result 生成层：
  - 窗口级 `filled_total` 按 scope 写入
  - 但 `realized_gross_pnl_total` 取 summary 值写入 postmortem
  - 形成窗口口径混合，导致 today 胜率/PNL 系统性失真。

### 证据索引
- `rules/task-reports/2026-04/260403_015/260403_015_truth_audit_today_summary_distortion.json`
- `rules/task-reports/2026-04/260403_015/260403_015_truth_audit_today_summary_distortion.log`
