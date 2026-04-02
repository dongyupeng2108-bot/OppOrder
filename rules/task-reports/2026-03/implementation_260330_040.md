# TraeTask_260330_040 实施记录（startup_active_snapshot_restore 最小修复）

## 范围执行

- 本轮仅修复 039 锁定断裂层 `startup_active_snapshot_restore`，并带掉次级现象 `saved_active_apply_timing`。
- 修改文件：
  - `strategies/crypto_binary/server.mjs`
  - `scripts/truth_audit_ladder_restore_fix_260330_040.mjs`
- 未修改：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
  - UI/PNL/账户链/版本测试总入口

## 修复点

- `setBotConfigCurrent`：
  - 统一同步 `botRunnerConfig`，不再仅限停止态；
  - 运行中更新配置时同步 `botActiveRuntimeConfig`。
- `restoreBotRecoverySnapshot`：
  - 恢复后 `botActiveRuntimeConfig` 取 `recoveredConfig(saved)`，不再优先吃 `snapshot.active_runtime_config` 旧值。
- `syncBotStateFromLedger`：
  - 仅按 `current_window_id` 汇总当前窗口 OPEN 订单到 `yes_order_ids/no_order_ids/ladder_posted`，避免旧窗口订单在启动链误注入当前执行态。

## 验证脚本

- 新增：`scripts/truth_audit_ladder_restore_fix_260330_040.mjs`
- 覆盖：
  - Fail -> Pass 主证据（读取 039 修前证据 + 040 修后样本）
  - 恢复/启动路径 real runtime 连续样本
  - 四方对账（strategy_setting / active / PLACE_LADDER / order_table）
  - 2 条不回退项
  - healthcheck（`GET /`、`GET /pairs`）

## 运行结果

- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/truth_audit_ladder_restore_fix_260330_040.mjs`：通过
- 主审计：
  - `node scripts/truth_audit_ladder_restore_fix_260330_040.mjs --task_id=260330_040 --sample=ladder_restore_fix_v1 --output=rules/task-reports/2026-03/260330_040_truth_audit_ladder_restore_fix.json`
  - `pass=true`
  - `first_break_layer=NONE_CHAIN_PASS`
