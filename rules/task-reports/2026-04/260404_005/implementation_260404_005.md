## TraeTask_260404_005 实施记录（运行可观测性补强）

### 范围与约束
- 仅修改 `strategies/crypto_binary/server.mjs` 与审计/报告文件。
- 未修改交易策略、订单执行、结算统计口径、stop 语义、UI、`verify_all_manual`、三大文档。

### 实施内容
- 在 server 内新增 1s 定时观测日志（仅 `runner_active=true` 时发射）：
  - 事件名：`BOT_PRICE_1S`
  - 来源：`source=server`
  - 频率：每秒最多 1 条（`setInterval(..., 1000)`）
- 每条日志固定输出以下字段（缺失显式 `null`）：
  - `current_window_id`
  - `btc_price`
  - `bid_yes`
  - `bid_no`
  - `ask_yes`
  - `ask_no`
  - `runner_active`
- 字段取值来源：
  - 优先 `botLastTickResult.context_snapshot`
  - 盘口补充来自 `_globalOrderbookMonitor.getLatestSnapshot()`（`bid_up/ask_up/bid_down/ask_down`）

### 语义保护
- 日志注入仅为旁路观测，不参与策略判定。
- `runner_active=false` 时直接不发秒级价格日志，stop 后自然停止。
- 未改任何下单节奏、成交逻辑、窗口 completed/postmortem 计算链。
