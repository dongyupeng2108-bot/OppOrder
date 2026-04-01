# TraeTask_260330_031 实施记录（cancel_decision_emission 最小修复）

## 范围与方式

- 本单仅修 `cancel_decision_emission`，不改 UI/PNL/账户链。
- 修复点限定在 `bot_strategy.mjs` 与 `bot_runner.mjs`。

## 修复内容

- `bot_strategy.mjs`
  - `has_open_down_orders` 与 `has_open_up_orders` 增加 `*_open_order_count` 计数兜底，避免仅依赖 `*_order_ids` 导致误判无 OPEN 单。

- `bot_runner.mjs`
  - 决策前补齐当前活动窗 OPEN 订单采样（YES/NO）。
  - 在 restart 后 `wait_next_window_after_start` 期间，满足：
    - 同窗存在 NO OPEN；
    - `remaining_sec <= down_cancel_before_end_sec`；
    - `no_cancelled !== true`
    时，强制发射 `CANCEL_OPEN(NO)`，并记录 `BOT_STARTUP_WAIT_FORCE_DOWN_CANCEL`。
  - 维持 startup-wait 对普通挂单行为的门控，避免扩散到非目标链路。

## 031 主审计脚本

- 新增：`scripts/truth_audit_cancel_decision_emission_fix_260330_031.mjs`
- 能力：
  - Fail->Pass 主证据（对照 030 锁定失败事实）
  - restart 场景 real runtime 连续样本
  - no-restart 非回退验证
  - 026 terminal_state_guard 非回退验证
  - order_id 级对账表

## 结果

- `first_break_layer = NONE_CHAIN_PASS`
- 修前：`cancel_open_no_emitted=false`、`cancel_execution_seen=false`
- 修后（restart 主场景）：`cancel_open_no_emitted=true`、`cancel_execution_seen=true`
