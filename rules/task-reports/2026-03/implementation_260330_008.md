# TraeTask_260330_008 实施记录（同窗撤单后重挂/误报链路）

## 唯一 first_break_layer

- `1）同窗口撤单后终态/防重挂判定层`
- 证据：旧策略在 `!ladder_posted` 分支缺少“同窗双方向已撤单终态”防重挂判断，导致 120/60 后再次进入 `PLACE_LADDER` 决策路径。

## 修复范围

- 本单仅改：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `scripts/truth_audit_no_reladder_log_order_consistency_260330_008.mjs`
- 未改：
  - `bot_runner.mjs`
  - `bot_order_ledger.mjs`
  - `server.mjs`
  - `ui/js/strategy-editor.js`

## 最小修复

- 在 `!ladder_posted` 决策入口新增同窗终态保护：
  - 若 `yes_cancelled===true && no_cancelled===true`，返回 `NOOP`，reason=`window_cancel_terminal_after_directional_before_end`
- 同时对重挂分支补方向保护：
  - `yes_cancelled===true` 不再重挂 YES
  - `no_cancelled===true` 不再重挂 NO

## 结果

- 120/60 撤单后同窗不再重挂阶梯单。
- 不再出现“日志说挂阶梯单、订单状态表无新增挂单”的分叉。
- 保持不回退：
  - 260329_004
  - 260329_007
  - 260329_008 / 260330_006
  - 260330_005
