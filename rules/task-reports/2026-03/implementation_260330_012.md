# TraeTask_260330_012 实施记录（context->ready 启动门控放行）

## 唯一 first_break_layer

- `context -> ready 门控层`
- 断裂表现：`wait_next_window_after_start` 在应放行阶段仍继续阻断。

## 最小修复

- 文件：`strategies/crypto_binary/bot_runner.mjs`
- 变更点：
  - 新增 `startupWindowGateLastRemainingSec` 跟踪启动等待期间的剩余秒。
  - 在 `wait_next_window` 门控下新增放行触发：
    - 既支持原有 `window_id` 变化放行；
    - 也支持同 `window_id` 下 `remaining_sec` 出现跨窗回卷（显著上跳）放行。
  - 放行日志增加 `release_reason`（`window_id_changed` / `remaining_rollover`）。
  - start/stop 时同步重置该门控跟踪值。

## 契约保持

- 启动后当前窗口仍阻断挂单（不放宽契约）。
- 到下一新窗口后可推进至决策层并触发合法 `PLACE_LADDER`。
- 未改 bounds/anchor、未改撤单/tp 语义、未改 UI 口径、未改账户链/PNL。

## 验证口径

- Fail->Pass（受控 + real runtime）：
  - 修前受控：第二次 tick 仍 `wait_next_window_after_start + NOOP`
  - 修后受控：从 startup wait 进入 `gate_context_not_ready_window_init`（表明 wait 已释放）
  - 修后 real runtime：跨新窗口后出现 `PLACE_LADDER(...)`，且 startup 窗口内不挂单。
