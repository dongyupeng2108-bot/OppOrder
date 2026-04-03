## TraeTask_260403_013 验收摘要（finalize 默认最小产物化）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`

### 新 finalize 默认最小产物表
- 默认保留（minimal）：
  - `result_*.json`
  - `notify_*.txt`
  - `*_truth_audit_*.json / *.log`
  - `evidence_manifest_*.json`
  - `deliverables_index_*.json`
  - `workspace_healer_*.json`
  - `run_*.log`
  - `dod_evidence_*.txt`
  - `git_meta_*.json`
  - `*_healthcheck_53122_root/pairs.txt`（命中时）
  - `gate_light_preview_*.log/.txt`

### 被降为按需/非默认的产物
- `ci_parity_*.json`
- `errors_*.jsonl`
- `errors_summary_*.txt`
- `preflight_attestation_*.json`

### 三组样本最小事实块
- light 样本（260330_045）：
  - finalize：`FINALIZE_ARTIFACT_MODE=minimal`
  - gate：`[Gate Light] PASS`，`GATE_LIGHT_EXIT=0`
- heavy 业务（260403_002）：
  - finalize：`FINALIZE_ARTIFACT_MODE=minimal`
  - gate：`Heavy mandatory evidence verified`
  - gate：`Healthcheck evidence verified`
  - gate：`SnippetCommitMustMatch verified`
  - gate：`GATE_LIGHT_EXIT=0`
- heavy 治理（260403_006）：
  - finalize：`FINALIZE_ARTIFACT_MODE=minimal`
  - gate：`Heavy mandatory evidence verified`
  - gate：`GATE_LIGHT_EXIT=0`

### 裁剪前后差异（full -> minimal）
- 样本差异联合集包含：
  - `ci_parity_*`
  - `errors_*.jsonl`
  - `errors_summary_*.txt`
  - `preflight_attestation_*.json`
- 说明：以上由默认全量改为按需生成，不影响 gate 判定语义。

### 证据索引
- `rules/task-reports/2026-04/260403_013/260403_013_truth_audit_finalize_minimal.json`
- `rules/task-reports/2026-04/260403_013/260403_013_truth_audit_finalize_minimal.log`
