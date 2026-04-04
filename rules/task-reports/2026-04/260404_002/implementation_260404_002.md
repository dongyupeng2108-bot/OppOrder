## TraeTask_260404_002 实施记录（single fill PNL=0 定位审计）

### 范围与约束
- 仅新增审计脚本与任务证据文件。
- 未修改 `server.mjs`、执行/结算/统计/UI 生产逻辑、`verify_all_manual`、三大文档。

### 审计实现
- 新增主审计脚本：
  - `scripts/260404_002/truth_audit_single_fill_pnl_zero_260404_002.mjs`
- 审计层次：
  - today summary 快照
  - `participating_postmortem_rows` 中 `filled_total=1` 全量窗口清单
  - row 与窗口真值（postmortem/result）对账
  - 至少 2 个真实窗口订单级手算（FILLED 订单、entry/exit 计数、realized 手算）

### 关键结论
- 本次 real runtime today 下，`filled_total=1` 的窗口均为“只有 ENTRY 成交、无 EXIT 成交”。
- 在当前业务口径（realized 仅由 EXIT 相对 ENTRY 均价产生）下，该类窗口 `realized_gross_pnl_total=0` 为口径预期。
- 未发现 today summary 聚合错算、未发现 row 与窗口真值断裂。
- 唯一 first_break_layer：`NONE_CHAIN_PASS`。

### 运行结果
- `node --check scripts/260404_002/truth_audit_single_fill_pnl_zero_260404_002.mjs`：通过
- 主审计脚本：通过（输出唯一 first_break_layer）
