# TraeTask_260330_044 实施记录（pnl_count_basis 修复）

## 范围执行

- 本轮仅修复 `pnl_count_basis`，不扩其它主线。
- 修改文件：
  - `strategies/crypto_binary/server.mjs`
  - `scripts/truth_audit_prev_result_basis_fix_260330_044.mjs`
- 未修改：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
  - 挂单逻辑、窗口标签、日志收口、账户链、recent summary 聚合语义

## 最小修复内容

- 修复点位：`queryLatestBotPostmortem`
- 口径策略：
  - 从最近 postmortem 候选（最多50条）中优先选取“非异常口径行”作为 `/bot/postmortem/latest`
  - 异常口径行定义：`filled_total=0 && cancelled_total=0 && realized_gross_pnl_total!=0`
  - 若全部候选都异常，回退到最新一条（兜底）
- 影响范围：
  - 仅影响 latest 投影链，不改变 `/bot/performance/summary` 聚合总语义

## 验证脚本

- 新增：`scripts/truth_audit_prev_result_basis_fix_260330_044.mjs`
- 覆盖：
  - Fail -> Pass 主证据（读取043修前异常证据 + 修后 latest）
  - real runtime 样本
  - DOM / latest / performance 三方对账
  - 两条不回退验证
  - healthcheck（`GET /`、`GET /pairs`）

## 运行结果

- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/truth_audit_prev_result_basis_fix_260330_044.mjs`：通过
- 主审计：
  - `node scripts/truth_audit_prev_result_basis_fix_260330_044.mjs --task_id=260330_044 --sample=prev_result_basis_fix_v1 --output=rules/task-reports/2026-03/260330_044_truth_audit_prev_result_basis_fix.json`
  - `pass=true`
  - `first_break_layer=NONE_CHAIN_PASS`
