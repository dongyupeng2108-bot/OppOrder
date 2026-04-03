## TraeTask_260403_008 验收摘要（completed_window_absent 上游定位）

### 结论块
- 结论：通过（定位完成，未修复业务逻辑）
- 唯一 first_break_layer：`completed_trigger_missing`
- 归因分类：`状态映射正确但 completed 触发缺失`

### 样本窗口（real runtime）
- `btc-updown-5m-1775138400`
- `btc-updown-5m-1775138700`

### 分层对账结论
- 样本基础层：
  - 两个样本均有 `BOT_FILL`，属于真实运行窗口。
- PM官方结算可观测层：
  - 对官方接口 `gamma-api.polymarket.com/markets/slug/{window}` 执行了每样本 3 次探测（间隔20s），均超时中止（`This operation was aborted`）。
  - 因网络不可达，官方 resolved/outcome 无法在本次环境直接读取。
- 本地抓取/映射层：
  - `/bot/status` 未暴露 `settlement_runtime/pending_settlement/...` 字段。
  - 样本窗口日志无 settlement 轮询/映射事件（计数 0）。
- completed 触发层：
  - `btc-updown-5m-1775138400`：无 `BOT_RUN_SNAPSHOT`，`completed_at=null`，未入 postmortem。
  - `btc-updown-5m-1775138700`：存在 `BOT_RUN_SNAPSHOT(MANUAL_STOP)`，`completed_at=2026-04-02T14:09:41.423Z`，已入 postmortem。
  - 对账显示 completed 落盘由 `BOT_RUN_SNAPSHOT` 触发，不是按窗口官方结算自动推进。
- today/postmortem 下游层：
  - 由于 `8400` 未 completed，today/postmortem 对该窗口为空是下游正常结果。

### 最小事实块
- PM官方状态关键行：
  - `official_probe_failed=true`，`attempt[1..3].error="This operation was aborted"`
- 本地抓取/缓存关键行：
  - `settlement_runtime_fields_exposed=false`
  - `settlement_logs_count=0`
- completed 条件关键行：
  - `8400: trigger_source=null, completed_at=null`
  - `8700: trigger_source=BOT_RUN_SNAPSHOT, completed_at=2026-04-02T14:09:41.423Z`
- postmortem/today 下游关键行：
  - `today_window_count=0, today_rows_count=0`
  - `8400: in_postmortem_7d=false`
  - `8700: in_postmortem_7d=true`

### 证据索引
- `rules/task-reports/2026-04/260403_008/260403_008_truth_audit_settlement_chain.json`
- `rules/task-reports/2026-04/260403_008/260403_008_truth_audit_settlement_chain.log`
