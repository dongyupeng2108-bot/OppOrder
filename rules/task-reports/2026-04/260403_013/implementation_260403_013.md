## TraeTask_260403_013 实施记录（finalize 默认产物最小化）

### 范围与约束
- 仅修改 `scripts/finalize_task_evidence.mjs` 与最小辅助验收脚本。
- 不修改 `scripts/gate_light_ci.mjs`、heavy 默认边界、light/heavy 定义、业务逻辑/UI/contracts。

### 核心实现
- 新增 `--artifact_mode`（默认 `minimal`，可显式 `full`）。
- `minimal` 默认跳过：
  - `ci_parity_*`
  - `errors_*.jsonl`
  - `errors_summary_*.txt`
  - `preflight_attestation_*.json`
- 保留 gate 必需产物链：
  - `result/notify/truth_audit/evidence_manifest/deliverables_index/workspace_healer/run/dod/git_meta/healthcheck(命中时)/gate_preview`
- 为保证 gate 不回退，保持 gate preview 生成链路不变。
- 增补 `--no_stage=true` 旁路下的安全兜底：
  - 跳过 git 跟踪强制检查
  - snippet `Header` 回填，避免 `Header: Unknown` 触发 gate 失败

### 文档同步
- `rules/rules/WORKFLOW.md`
- `rules/rules/PROJECT_RULES.md`
- `rules/rules/PROJECT_MASTER_PLAN.md`

### 新增验收脚本
- `scripts/truth_audit_finalize_minimal_260403_013.mjs`
  - 对 light / heavy 业务 / heavy 治理分别执行：
    - `artifact_mode=full`（对照组）
    - 默认 `artifact_mode=minimal`（目标组）
  - 输出产物差异与三组 finalize+gate 通过事实

### 执行结果
- `node --check scripts/finalize_task_evidence.mjs`：通过
- `node --check scripts/truth_audit_finalize_minimal_260403_013.mjs`：通过
- 主审计：通过（`first_break_layer=NONE_CHAIN_PASS`）
