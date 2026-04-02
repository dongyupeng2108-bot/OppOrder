# TraeTask_260330_040 验收摘要（恢复链旧点位复活修复）

## 结论块

- 结论：**通过（修复验收完成）**
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复目标闭环：
  - `startup_active_snapshot_restore` 已收敛
  - `saved_active_apply_timing` 次级现象已收敛

## 最小事实块

- 修前旧点位证据（039）：
  - `saved_signature=new`
  - `active_signature/place_signature=YES[0.21:5:0.31,0.23:5:0.33]|NO[0.25:6:0.35,0.27:6:0.37]`
- 修后四方一致（040 after_update）：
  - `strategy_setting=saved=YES[0.88:11:0.96,0.89:11:0.97]|NO[0.9:12:0.98,0.91:12:0.99]`
  - `active=YES[0.88:11:0.96,0.89:11:0.97]|NO[0.9:12:0.98,0.91:12:0.99]`
  - `PLACE_LADDER=YES[0.88:11:0.96,0.89:11:0.97]|NO[0.9:12:0.98,0.91:12:0.99]`
  - `order_table=YES[0.88:11:0.96,0.89:11:0.97]|NO[0.9:12:0.98,0.91:12:0.99]`
- 真实 PLACE_LADDER 日志行：
  - `PLACE_LADDER(YES|0.88:11:0.96,0.89:11:0.97) + PLACE_LADDER(NO|0.9:12:0.98,0.91:12:0.99)`
- 不回退项：
  - 无恢复链场景下，新配置挂单链正常（`non_regression_no_recovery=true`）
  - 历史旧点位 `0.21/0.23/0.25/0.27` 未再被恢复链带回（`non_regression_old_not_resurrected=true`）
- healthcheck：
  - `GET / = 200`
  - `GET /pairs = 404`（已回报原样状态）

## 证据索引

- `rules/task-reports/2026-03/260330_040_truth_audit_ladder_restore_fix.json`
- `rules/task-reports/2026-03/260330_040_truth_audit_ladder_restore_fix.log`
- `rules/task-reports/2026-03/260330_040_truth_audit_ladder_restore_fix.heartbeat.log`
- 修前对照：`rules/task-reports/2026-03/260330_039_truth_audit_ladder_point_hypothesis_chain.json`
