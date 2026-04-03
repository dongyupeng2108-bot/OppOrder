## TraeTask_260403_011 验收摘要（today 清空按钮 + baseline 重置）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`

### 修前/修后 today、7d、30窗口对照
- today（修前）：
  - `window_count=10`
  - `filled_total=37`
  - `realized_gross_pnl_total=168.70174420229682`
  - `avg_realized_gross_pnl_per_window=16.87017442022968`
- today（点击清空后）：
  - `window_count=0`
  - `filled_total=0`
  - `realized_gross_pnl_total=0`
  - `avg_realized_gross_pnl_per_window=0`
- 7d（前后一致）：
  - `window_count=1486`
  - `filled_total=1813`
  - `realized_gross_pnl_total=1663.6677754159984`
  - `avg_realized_gross_pnl_per_window=1.119561087090174`
- 30窗口（前后一致）：
  - `window_count=30`
  - `filled_total=394`
  - `realized_gross_pnl_total=345.01316656292454`
  - `avg_realized_gross_pnl_per_window=11.500438885430817`

### 历史真值未删除证明
- reset 前后 `last_30_window_ids` 完全一致
- reset 前后 `last_7d_window_count=1486` 一致
- 说明：未删除订单真值、未删除 postmortem 原始行，仅调整 today 统计基线

### real runtime 新 completed window 纳入 today（reset后）
- `today_reset_baseline_at=2026-04-03T10:17:49.846Z`
- 新 completed 窗口：
  - `window_id=btc-updown-5m-1775211300`
  - `completed_at=2026-04-03T10:17:50.702Z`
  - 满足 `completed_at >= baseline`，已纳入 today

### running 未提前计入事实块
- 运行中窗口：`btc-updown-5m-1775211300`
- 运行期间检查：`included_in_today_while_running=false`

### stop 语义未变事实块
- stop 响应：`ok=true`，`already_stopped=false`
- 同一窗口生成 `BOT_RUN_SNAPSHOT`：
  - `message=MANUAL_STOP`
  - `stop_reason=MANUAL_STOP`
  - `completed_at=2026-04-03T10:17:50.702Z`
- 说明：stop 后统计链继续完成并落盘，不跳过 completed/postmortem

### Healthcheck 关键行
- `GET /`：`200`，`{"status":"ok","port":53131,"strategy":"crypto_binary","runner_active":false}`
- `GET /pairs`：`404`，`{"status":"not_found"}`

### 证据索引
- `rules/task-reports/2026-04/260403_011/260403_011_truth_audit_today_reset_baseline.json`
- `rules/task-reports/2026-04/260403_011/260403_011_truth_audit_today_reset_baseline.log`
