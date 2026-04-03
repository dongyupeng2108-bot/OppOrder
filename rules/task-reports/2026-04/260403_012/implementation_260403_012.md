## TraeTask_260403_012 实施记录（Heavy Mandatory Evidence 收缩）

### 范围与约束
- 仅修改 heavy mandatory evidence 判定，不触碰 finalize、heavy 默认边界、业务代码/UI/contracts。
- 保留：SnippetCommitMustMatch、全量 heavy checks、260403_004/005/006 提效能力。

### 脚本修改
- `scripts/gate_light_ci.mjs`
  - 重写 heavy mandatory 识别逻辑：
    - 业务 heavy 阻断项：`first_break_layer` / `Fail->Pass` / `real_runtime` / `non_regression`；若改 server 再要求 `healthcheck`。
    - 治理 heavy 阻断项：`first_break_layer` / `Fail->Pass` / 治理替代证据；不再阻断流程元证据。
  - 流程元证据降级为 warn（`HEAVY_PARALLEL_START`、profile split 痕迹、gate/finalize 流程日志字样等）。

### 文档修改
- `rules/rules/WORKFLOW.md`
- `rules/rules/PROJECT_RULES.md`
- `rules/rules/PROJECT_MASTER_PLAN.md`
- 同步写清：
  - 业务 heavy mandatory 集
  - 治理 heavy substitute 集
  - 流程元证据 warn 降级清单

### 新增验收脚本
- `scripts/truth_audit_heavy_mandatory_rewrite_260403_012.mjs`
  - 样本验证：
    - 业务 heavy：260403_002
    - 治理 heavy：260403_006
    - 负例：删除 real_runtime 证据后应失败
    - light 烟雾：260330_045

### 执行结果
- `node --check`：通过
- 主验收脚本：通过（四项检查全满足）
