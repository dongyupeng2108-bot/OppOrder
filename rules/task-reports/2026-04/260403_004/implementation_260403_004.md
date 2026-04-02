## TraeTask_260403_004 实施记录（heavy gate 提效：并行 + 单会话复用）

### 范围
- 仅优化 heavy 执行效率；不改覆盖项与强制项；不改 light。

### 脚本改动
- `scripts/gate_light_ci.mjs`
  - 新增并行执行：news/rank/export/ledger 并行；scanner/universe/trading 并行
  - 新增 mock server 会话：Rank/Export/Ledger 单次启动、复用、统一关停
  - 输出标记：`MOCK_SERVER_SESSION=*`、`HEAVY_PARALLEL_START/DONE`
- 新增治理验收脚本：`scripts/truth_audit_heavy_gate_efficiency_260403_004.mjs`

### 文档改动
- `rules/rules/WORKFLOW.md`：heavy-only 增加“提效允许项”描述
- `rules/rules/PROJECT_RULES.md`：重任务 mandatory 增加“提效允许项”描述
- `rules/rules/PROJECT_MASTER_PLAN.md`：gate 分流处追加 260403_004 提效边界说明

### 运行
- `node --check scripts/gate_light_ci.mjs`：通过
- `node --check scripts/truth_audit_heavy_gate_efficiency_260403_004.mjs`：通过
- 主验收脚本执行 PASS，详见 truth_audit 文档
