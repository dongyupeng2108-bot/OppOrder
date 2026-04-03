## TraeTask_260403_012 验收摘要（Heavy Mandatory Evidence 收缩）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`

### 新 Heavy Mandatory 阻断表
- 业务 heavy（阻断）：
  - `first_break_layer`
  - `Fail->Pass`
  - `real_runtime`
  - `non_regression`
  - `healthcheck`（仅命中 server 改动时）
- 治理 heavy（阻断）：
  - `first_break_layer`
  - `Fail->Pass`
  - 治理替代证据（治理结果本身）
- 明确不再阻断：
  - `HEAVY_PARALLEL_START`
  - profile split 痕迹
  - gate/finalize 内部流程日志字样
  - 其他“为了证明门禁而生成的门禁证据”

### 最小事实块
- 业务 heavy 样本（260403_002）关键行：
  - `[Gate Light] Heavy mandatory evidence verified.`
  - `[Gate Light] PASS`
  - `GATE_LIGHT_EXIT=0`
- 治理 heavy 样本（260403_006）关键行：
  - `heavy_mode=governance`
  - `[Gate Light] Heavy mandatory evidence verified.`
  - `[Gate Light] PASS`
- 负例关键行（缺失 real_runtime）：
  - `[Gate Light] FAILED: Heavy mandatory evidence incomplete.`
  - `heavy_mode=business`
  - `has_real_runtime=false`
- light 烟雾（260330_045）关键行：
  - `[Gate Light] LIGHT profile: heavy mandatory evidence checks skipped.`
  - `[Gate Light] PASS`
  - `GATE_LIGHT_EXIT=0`

### 证据索引
- `rules/task-reports/2026-04/260403_012/260403_012_truth_audit_heavy_mandatory_rewrite.json`
- `rules/task-reports/2026-04/260403_012/260403_012_truth_audit_heavy_mandatory_rewrite.log`
