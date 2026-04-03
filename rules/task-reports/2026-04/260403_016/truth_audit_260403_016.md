## TraeTask_260403_016 验收摘要（Fix + Acceptance）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复目标：`postmortem_result_snapshot_scope_mismatch` 已消除（新污染未再出现）

### 修复范围
- `server.mjs`：仅 postmortem/result 生成口径修复
  - row `realized_gross_pnl_total` 改为窗口 scoped truth
  - 不再写 summary 级 realized

### 修前污染样本（来自 260403_015）
- `btc-updown-5m-1775239500`：row pnl `42.07807663910079`，truth pnl `0`
- `btc-updown-5m-1775239200`：row pnl `42.07501097522348`，truth pnl `0`

### 修后（reset baseline 后）新 completed window 对账
- `btc-updown-5m-1775242500`：
  - row filled=`0`，truth filled=`0`
  - row pnl=`0`，truth pnl=`0`
  - 计入胜率分子：`false`
- `btc-updown-5m-1775242200`：
  - row filled=`4`，truth filled=`4`
  - row pnl=`0`，truth pnl=`0`
  - 计入胜率分子：`false`

### 修后手算（reset 后参与集合）
- `win_numerator=0`
- `win_denominator=2`
- `win_rate=0%`
- `Σ realized_gross_pnl_total=0`

### 不回退事实块
- running window 不提前计入 today：`running_window_not_counted=true`
- stop 语义未破坏统计链：`stop_semantics_chain_alive=true`
- today reset baseline 仍可用：`today_reset_baseline_usable=true`

### healthcheck
- `GET /`：`200`
- `GET /pairs`：`404`（端点已检查并记录，不影响本修复口径验收）

### 证据索引
- `rules/task-reports/2026-04/260403_016/260403_016_truth_audit_postmortem_scope_fix.json`
- `rules/task-reports/2026-04/260403_016/260403_016_truth_audit_postmortem_scope_fix.log`
