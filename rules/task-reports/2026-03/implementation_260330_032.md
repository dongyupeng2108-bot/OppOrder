# TraeTask_260330_032 实施记录（防回归沉淀）

## 变更范围

- 仅新增防回归验证脚本并接入总入口清单。
- 未修改业务逻辑文件：`strategies/crypto_binary/bot_runner.mjs`、`strategies/crypto_binary/bot_strategy.mjs`。
- 未修改 UI、PNL、账户链、`finalize_task_evidence.mjs`、`gate_light_ci.mjs`。

## 新增稳定回归脚本

- 新增：`scripts/verify_cancel_decision_emission_restart_guard_260330_032.mjs`
- 目标：固化 031 已通过高风险不变量：
  - restart 同窗 + NO OPEN + `remaining_sec<=60` 时必须出现 `CANCEL_OPEN(NO)` 与 cancel result。
- 统一事实输出：
  - `tracked_no_order_id`
  - `remaining_sec_before_threshold`
  - `remaining_sec_after_threshold`
  - `cancel_open_no_emitted`
  - `cancel_execution_seen`
  - `conclusion_block.reason_code`
- 收束护栏：
  - 包装脚本 `MAX_WALL_TIME=15min`
  - 继承 031 审计脚本心跳与显式退出原因码输出（含 `runtime_exit_shapes` 与 heartbeat log）

## 总入口挂接

- 修改：`scripts/verify_all_manual.mjs`
- 已在以下清单挂接新脚本：
  - `VERIFY_TARGET_ALLCHAIN`
  - `module5`
- 挂接样本名：`restart_same_window_down_cancel_guard_v1`

## 本轮验证

- 脚本语法：
  - `node --check scripts/verify_cancel_decision_emission_restart_guard_260330_032.mjs` 通过
  - `node --check scripts/verify_all_manual.mjs` 通过
- 新脚本单跑：
  - `node scripts/verify_cancel_decision_emission_restart_guard_260330_032.mjs --task_id=260330_032 --sample=restart_same_window_down_cancel_guard_v1 --output=rules/task-reports/2026-03/260330_032_verify_cancel_decision_emission_restart_guard_260330_032.json`
  - 结果：`pass=true`，`reason_code=NONE`
  - 关键事实：`tracked_no_order_id=paper_62606315`，`cancel_open_no_emitted=true`，`cancel_execution_seen=true`

## 备注

- 按用户当前指令，本轮不再默认执行 `verify_all_manual.mjs` 全量运行，仅提供“总入口已挂接”的清单事实与新脚本单跑 PASS 事实。
