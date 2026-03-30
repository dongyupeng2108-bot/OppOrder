# TraeTask_260330_004 实施记录（实时日志默认关键信息流）

## 范围结论

- 本单仅改展示层：
  - `ui/js/strategy-editor.js`
  - `scripts/truth_audit_log_display_layer_260330_004.mjs`
- 未改执行主链与日志生产链。

## 改造内容

- 默认日志视图改为“关键信息流”。
- 新增“原始日志”二层视图切换，保留全部原始事件可追溯。
- 高频噪声默认折叠：
  - `NOOP`
  - `scheduled tick ok`
  - `tick price_or_bounds_null`
  - 其他空转/心跳等价形态
- 事件文案收口为状态句，示例：
  - `等待价格与边界数据`
  - `进入新窗口，开始等待 open_delay`
  - `已挂 UP 2 单 / DOWN 2 单`
  - `NO 方向 1 单成交`
  - `UP 到时撤单（120秒）`

## 展示分层

- 一层（默认）：关键信息流（动作与状态变化）
- 二层：原始日志（含原始 event/message）

## 不回退确认

- 未改 `bot_strategy*.mjs`
- 未改 `bot_runner.mjs`
- 未改 `bot_order_ledger.mjs`
- 未改版本测试模块
- 未改 signer/余额链
- 未改 PNL/today
