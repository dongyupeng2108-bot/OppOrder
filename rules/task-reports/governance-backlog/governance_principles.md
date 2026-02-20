# governance-backlog：治理原则与任务拆分

## 任务拆分（4 个批次）
1. Task#1（260221_001）：治理原则落盘（WORKFLOW/PROJECT_RULES）+ governance-backlog 建档（不改代码/脚本/CI）
2. Task#2（后续再发）：Evidence Contract（证据契约）表 + Troubleshooting Playbook（排查手册）落盘
3. Task#3（后续再发）：assemble_evidence 增加 contract self-check summary（契约自检摘要）
4. Task#4（后续再发）：一键重建证据（regen）+ CI verify-only（只验证、不重写受跟踪证据）边界治理

## Governance Principles（治理原则）
1. Complexity Budget（复杂度预算）：任何新增治理规则必须 **减少** 人工步骤或状态空间；若只增加人工步骤/例外判断，一律禁止落地。 
2. Automation-Only Rule（自动化优先）：任何新增规则若不能被脚本自动检查/自动生成，则不得新增（先补自动化再写规则）。 
3. Single Writer Boundary（单写入者边界）：受 git 跟踪的证据文件（notify/result/index/envelope/snippet 等）只允许 Integrate（集成）产出并提交；CI 角色必须是 verify-only（只验证）。 
4. No Split-Brain（禁止分裂脑）：禁止 CI 或脚本“重写已有受跟踪证据文件”造成本地/CI 证据互相覆盖；如需生成，仅允许生成临时日志或缺失文件（后续任务实现）。 
5. Evidence = Commit Snapshot（证据=提交快照）：代码（尤其门禁相关）一动即证据必须重建并提交；不得“改代码不刷新证据”。 
6. Fix-Front Only（只修最前失败点）：门禁失败按顺序逐层清零；一次修复=一次最小提交；禁止并行混修多个失败点。 
7. No Bypass（禁止绕过）：禁止为让 CI 过而削弱/删除校验；允许的紧急修复仅限“补字段/补 marker/增强可观测性”，不得夹带重构。 
8. Determinism First（确定性优先）：证据生成必须确定性（同输入同输出）；输出统一 LF（换行）与 UTF-8（无 BOM），避免跨平台哈希不一致。 
9. Source of Truth（事实来源）：工程状态以 GitHub Actions CI + 锁文件为准；文档必须明确 writer/verifier 边界与例外处理口径。 
10. Change Containment（变更收敛）：治理改动优先“新增自检/摘要/工具入口”，避免在多个位置同时修改规则与实现导致漂移。 
