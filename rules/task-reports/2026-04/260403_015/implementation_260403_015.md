## TraeTask_260403_015 实施记录（today 胜率/PNL 失真定位）

### 范围与约束
- 仅新增审计脚本与任务证据文件。
- 未修改 `server.mjs` 业务逻辑、未修改 UI/统计生产逻辑、未改 verify 总入口、未改三大文档。

### 新增脚本
- `scripts/260403_015/truth_audit_today_summary_distortion_260403_015.mjs`

### 审计执行链
- 固定一次 today 快照：`/bot/performance/summary?preset=today&detail=1`
- 对账层次：
  - UI/接口投影（读取 `ui/js/strategy-editor.js` 投影逻辑）
  - today summary 聚合（字段与 participating rows 手算对账）
  - participating_postmortem_rows（输出前 20 行 + 异常行）
  - 订单真值抽样（3 窗口：高盈利、零成交异常、普通成交）

### 关键发现
- UI 为接口直投，非额外计算偏差源。
- summary 与 participating rows 手算完全一致，聚合层无数学偏差。
- participating rows 中存在大量 `filled_total=0` 但 `realized_gross_pnl_total>0` 行，被计入胜率分子与 PNL 累加。
- 3 个订单真值样本均显示：窗口级真值 `realized_gross_pnl_total_truth=0`，但 postmortem 行写入约 `42.x`。
- 根因层位于 postmortem/result 生成：写入时采用“filled_total 按窗口 scope + realized_gross_pnl_total 取 summary 值”的混合口径，导致窗口级 PNL 失真并累计放大。

### first_break_layer
- `postmortem_result_snapshot_scope_mismatch`

### 执行结果
- `node --check scripts/260403_015/truth_audit_today_summary_distortion_260403_015.mjs`：通过
- 主审计脚本：通过（输出唯一 first_break_layer）
