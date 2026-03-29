# TraeTask_260329_008 实施记录（分方向撤单 before_end_sec 优先级）

## 定位结论

- 唯一 first_break_layer：**2. 旧全局 cancel_all_remaining_sec 优先级层**
- 修前断裂：在 `remaining_sec<=cancel_all_remaining_sec` 时，旧全局路径会提前覆盖 NO 侧 `before_end_sec=60`，导致 NO 在约 100 秒被全局撤单。

## 修复范围

- `strategies/crypto_binary/bot_strategy.mjs`
- `scripts/truth_audit_directional_cancel_priority_260329_008.mjs`

## 核心修复

- `parseCancelConfig` 增加 `before_end_source`（`explicit/global_fallback`）。
- 新增“全局兼容触发”判定：
  - 仅当该方向满足全局兼容条件（来源为 fallback，或 `before_end_sec==cancel_all_remaining_sec` 且 formula 为空）才允许全局阈值驱动撤单。
- 全局阈值不再无条件 `CANCEL_OPEN(ALL)`：
  - 双侧都兼容时才走 `CANCEL_OPEN(ALL)`（兼容路径）；
  - 单侧兼容时改为单侧取消（`up_cancel_global_compat/down_cancel_global_compat`）；
  - 分方向显式阈值（如 NO=60、YES=120）优先级高于旧全局。
- diagnostics 补充：
  - `up/down_global_compat`
  - `trigger_up/down_global_compat`

## 结果

- YES=120、NO=60 时，两侧撤单时点独立生效。
- 旧 `cancel_all_remaining_sec=100` 不再覆盖 NO=60 的显式配置。
- reason/intents 可区分分方向撤单路径。
- 260329_004（等新窗口）与 260329_007（当前窗口状态不混错窗）不回退。
