## TraeTask_260403_016 实施记录（postmortem scope mismatch 修复）

### 范围与约束
- 仅修改 `strategies/crypto_binary/server.mjs` 中 postmortem/result 生成相关路径。
- 不改 UI、today reset 机制、订单真值链计算模块、verify 总入口、三大文档。

### 修复内容
- 新增窗口级 realized 计算函数：`getScopedRealizedGrossPnlTotalForState(state, preferredWindowId)`。
- `finalizeBotRunSnapshot` 写入 `realized_gross_pnl_total` 时，改为使用窗口 scoped realized，不再写 summary 级 realized。
- 保持 `filled_total` 仍为窗口 scoped，保持其他字段语义不变。

### 验收脚本
- 新增：`scripts/260403_016/truth_audit_postmortem_scope_fix_260403_016.mjs`
- 覆盖：
  - 修前污染证据（复用 260403_015，至少2条）
  - reset today baseline 后至少2个新 completed window 的 row/truth 对账
  - running 不提前计入、stop 后统计链可用
  - GET `/` 与 GET `/pairs` healthcheck 记录

### 运行结论
- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/260403_016/truth_audit_postmortem_scope_fix_260403_016.mjs`：通过
- 主审计：通过（`first_break_layer=NONE_CHAIN_PASS`）
