## TraeTask_260403_017 实施记录（notify healthcheck 摘录治理修补）

### 范围与约束
- 仅修补 notify/healthcheck 摘录与校验链。
- 未修改 `server.mjs`、BTCQDD 执行/统计/UI 业务逻辑、verify_all_manual、三大文档结构。

### 修复点
- `scripts/finalize_task_evidence.mjs`
  - healthcheck 证据生成优先读取同任务 truth_audit JSON 的 `healthcheck.root_status/pairs_status` 作为同源真值。
  - root/pairs 分别独立写入各自文件，不再固定双写 200。
- `scripts/gate_light_ci.mjs`
  - healthcheck 文件改为校验“有效 HTTP 状态行”，不再硬编码 200。
  - notify 的 DOD_EVIDENCE_HEALTHCHECK_ROOT/PAIRS 改为与各自 healthcheck 文件首行逐字一致校验。
- `scripts/postflight_validate_envelope.mjs`
  - healthcheck 内容校验改为“有效 HTTP 状态行”，避免把非 200 误判为无效证据。
- 新增主审计脚本：
  - `scripts/260403_017/truth_audit_notify_healthcheck_excerpt_fix_260403_017.mjs`

### 结果
- 修前冲突可复现（260403_016：JSON pairs=404，但 notify 摘录 pairs=200 OK）。
- 修后三者一致：
  - 主验收 JSON：root=200, pairs=404
  - healthcheck 文件原文：root=HTTP/1.1 200 OK，pairs=HTTP/1.1 404 Not Found
  - notify 摘录行与对应文件逐字一致
