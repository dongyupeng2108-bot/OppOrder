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
- 已定位断层：窗口已结束后，单成交窗口的结算收益未投影进 `realized_gross_pnl_total`。
- 反事实手算显示：`price=0.01` 时结算后 PNL 只能是 `+0.99 / -0.01`；`price=0.3` 时只能是 `+0.7 / -0.3`，均不可能为 0。
- today summary 与 row 对账一致，但一致地继承了“仅按 EXIT 计算 realized、未结算投影”的结果链缺口。
- 唯一 first_break_layer：`order_truth_to_window_result_settlement_projection_missing`。

### 运行结果
- `node --check scripts/260404_002/truth_audit_single_fill_pnl_zero_260404_002.mjs`：通过
- 主审计脚本：通过（输出唯一 first_break_layer）
