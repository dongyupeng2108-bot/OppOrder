## TraeTask_260403_002 实施记录（today rollup 口径修复）

### 范围与改动
- 仅修复 today 汇总纳入口径（window_rollup_count_basis），不改前端、不改单窗口结果、不改官方 resolved 链。
- 修改：
  - `strategies/crypto_binary/server.mjs`：today 起点改为 UTC 零点（`setUTCHours(0,0,0,0)`）
  - 新增验收脚本：`scripts/truth_audit_today_rollup_fix_260403_002.mjs`
- 未修改：
  - `/bot/performance/summary` 的 last_7d 逻辑与聚合语义
  - 单窗口结果生成链

### 修复原因
- 修前 today 以本地时区零点作为分界，导致“实际今日 completed 窗口”未被纳入；与 last_7d 口径不一致。
- 改为 UTC 零点后，today 与 last_7d 对“今日窗口可纳入”保持同源口径。

### 运行与结果
- 命令：
  - `node --check strategies/crypto_binary/server.mjs`
  - `node --check scripts/truth_audit_today_rollup_fix_260403_002.mjs`
  - `node scripts/truth_audit_today_rollup_fix_260403_002.mjs --task_id=260403_002 --sample=today_rollup_fix_v1 --output=rules/task-reports/2026-04/260403_002/260403_002_truth_audit_today_rollup_fix.json`
- 结果：`pass=true`，`first_break_layer=NONE_CHAIN_PASS`
