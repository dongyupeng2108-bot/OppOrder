## TraeTask_260403_003 实施记录（轻/重任务收尾与 gate 分流落地校正）

### 范围与原则
- 不新增第三分级，仅 light/heavy 两层；不改业务链。
- 只在现有 finalize/gate 体系内做分流落地。

### 脚本改动
- `scripts/gate_light_ci.mjs`
  - 新增 `--profile light|heavy|auto`，内部检测 TASK_PROFILE
  - light：跳过 heavy-only 合约检查（news/rank/export/ledger/scanner/universe/trading）与 `SnippetCommitMustMatch`；保留基础治理检查（LATEST/范围锁/postflight/envelope/healthcheck/Healer 等）
  - heavy：保留全量合约检查与 heavy mandatory 证据校验（first_break_layer / Fail->Pass / real runtime / 不回退）
- `scripts/finalize_task_evidence.mjs`
  - 透传 `--profile` 到 gate
- 新增验证脚本：`scripts/truth_audit_workflow_profile_split_260403_003.mjs`
  - 使用已完成样本：light=260330_045，heavy=260403_002
  - 运行 gate 并比对 profile 行为差异；不改业务

### 文档改动
- `rules/rules/WORKFLOW.md`：收尾链按 light/heavy 调用 finalize 与 gate；新增差异说明章节
- `rules/rules/PROJECT_RULES.md`：轻/重任务最小提交集与 gate 执行命令补充 profile；明确 heavy-only 与 both
- `rules/rules/PROJECT_MASTER_PLAN.md`：收口与 gate 分流口径落地；强调仅两层

### 生效时点
- 合入后下一条新任务起生效；已在执行中的任务不切换。

### 运行结果
- `node --check scripts/gate_light_ci.mjs`：通过
- `node --check scripts/finalize_task_evidence.mjs`：通过
- `node --check scripts/truth_audit_workflow_profile_split_260403_003.mjs`：通过
- 主审计：
  - PASS，`first_break_layer=NONE_CHAIN_PASS`

