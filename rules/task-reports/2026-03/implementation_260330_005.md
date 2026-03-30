# TraeTask_260330_005 实施记录（关键流补回挂单完成）

## 范围结论

- 本单仅改：
  - `ui/js/strategy-editor.js`
  - `scripts/truth_audit_key_log_actions_260330_005.mjs`
- 未改执行主链与日志生产主链。

## 断点定位

- 挂单完成主事实在真实日志链中常落在 `BOT_INTENTS`（`PLACE_LADDER(...)`）。
- 260330_004 版本默认关键流只将 `BOT_ORDER_APPLY` 视为关键事件，导致当场景仅出现 `BOT_INTENTS` 时，“挂单完成”未进默认关键流。

## 修复内容

- 新增 `se_logIntentsToken`，统一从 `data.intents_summary` 或 `message` 读取意图摘要。
- 在状态句映射中补 `BOT_INTENTS`：
  - `PLACE_LADDER(BOTH|YES|NO)` -> 挂单完成状态句
  - `CANCEL_OPEN(YES|NO)` -> 分方向撤单状态句
  - `NOOP` -> 本周期无动作
- 在关键事件筛选中补 `BOT_INTENTS`（仅 `PLACE_LADDER` / `CANCEL_OPEN` 进入关键流）。
- 保持噪声折叠规则不变：`NOOP / scheduled tick ok / price_or_bounds_null` 仍不刷默认主视图。

## 结果

- 默认关键信息流可稳定看到“挂单完成 / 成交 / 撤单”。
- 原始日志二层保持可追溯，不影响审计回放。
