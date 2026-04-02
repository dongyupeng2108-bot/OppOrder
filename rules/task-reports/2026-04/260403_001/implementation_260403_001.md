# TraeTask_260403_001 实施记录（PM官方→单窗口→汇总→前端 分层对账定位）

## 范围执行

- 本任务仅做定位审计，不改业务逻辑/接口语义/前端显示。
- 新增主审计脚本：`scripts/truth_audit_pm_stats_chain_260403_001.mjs`
- 只读采集对象：
  - `/bot/performance/summary?preset=today&detail=1`
  - `/bot/performance/summary?preset=last_7d&detail=1`
  - `/bot/status`
- 采用 real runtime 样本（由 performance summary 提供的参与窗口行）

## 审计分层

- 官方结算真值层（可用性）：当前环境无官方 PM 直连，标记 `official_available=false`
- 单窗口结果层：使用 `participating_postmortem_rows` 中 `bot_completed_at`/`completed_at` 的窗口行
- 汇总统计层：`summary.window_count / filled_total / realized_gross_pnl_total / avg_realized_gross_pnl_per_window`
- 前端投影层：`/bot/performance/summary?detail=1` → `se-perf-*` DOM

## 执行结果

- 最少样本：脚本从 today + last_7d rows 中选择 ≥2 个 `COMPLETED` 窗口（若不足则标阻断）
- 结论：见 `truth_audit_260403_001.md`
- 护栏：`MAX_WALL_TIME=50min`、`MAX_SILENCE=5min`、`LOG_TAIL=150`

## 运行命令

- `node --check scripts/truth_audit_pm_stats_chain_260403_001.mjs`
- `node scripts/truth_audit_pm_stats_chain_260403_001.mjs --task_id=260403_001 --sample=pm_stats_chain_v1 --output=rules/task-reports/2026-04/260403_001/260403_001_truth_audit_pm_stats_chain.json`
