## TraeTask_260403_010 验收摘要（Fix + Acceptance，heavy）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复点：completed 触发从“依赖停机快照”扩展为“窗口切换完成事实触发（WINDOW_CHANGED）”

### 修前/修后对账（completed 触发链）
- 修前坏样本（历史类型）：`btc-updown-5m-1775138400`
  - `trigger_source=null` / `completed_at=null` / `has_postmortem_row=false`
- 修后 real runtime 样本：`btc-updown-5m-1775208000`
  - `trigger_source=WINDOW_CHANGED`
  - `completed_at=2026-04-03T09:25:00.843Z`
  - `has_postmortem_row=true`

### Fail -> Pass 事实块
- Fail（历史坏样本类型）：
  - `window_id=btc-updown-5m-1775138400`
  - `trigger_source=null`
  - `completed_at=null`
  - `has_postmortem_row=false`
- Pass（修后真实窗口）：
  - `window_id=btc-updown-5m-1775208000`
  - `BOT_RUN_SNAPSHOT.message=WINDOW_ROLLOVER_COMPLETED`
  - `trigger_source=WINDOW_CHANGED`
  - `completed_at=2026-04-03T09:25:00.843Z`
  - `has_postmortem_row=true`

### 不回退事实块（2条）
- 正常已完成样本未被改坏：
  - `btc-updown-5m-1775138700` 仍存在 completed 行（`completed_at=2026-04-02T14:09:41.423Z`）
- running 窗口未提前 completed：
  - `current_window_id=null` 且 `has_postmortem_row_in_7d=false`
- summary 语义烟雾：
  - `today_running_window_excluded=true`
  - `last7d_running_window_excluded=true`

### Server healthcheck 关键行
- `GET /`：`200`，`{"status":"ok","port":53130,...}`
- `GET /pairs`：`404`，`{"status":"not_found"}`

### 证据索引
- `rules/task-reports/2026-04/260403_010/260403_010_truth_audit_completed_trigger_fix.json`
- `rules/task-reports/2026-04/260403_010/260403_010_truth_audit_completed_trigger_fix.log`
