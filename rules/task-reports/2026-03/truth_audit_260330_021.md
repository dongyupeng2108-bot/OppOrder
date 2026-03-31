# TraeTask_260330_021 验收摘要（当前窗口订单状态字段链）

## 结论

- 验收结论：**通过（定位任务）**
- verdict：`A：通过`
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- real/debug：未分叉（`none`）

## 最小事实摘录

- 当前窗口订单状态完整字段清单（DOM 顺序）：
  - 顶部：`BTC价格 / UPDOWN概率 / 波动值`
  - 表头：`订单类型 / UP-DOWN / 价格 / 数量 / 平仓价 / 状态`
- real runtime 三阶段覆盖：
  - `saw_place_stage=true`
  - `saw_terminal_stage=true`
  - `saw_window_switch=true`
- 关键窗口值：
  - `current_window_id=btc-updown-5m-1774920000`
  - `last_window_id=btc-updown-5m-1774919700`
- 至少两条 order_id 状态投影：
  - `paper_4bd28f0a` -> `状态=已成交`
  - `paper_28bd976f` -> `状态=已成交`
- 逐字段对账：样本字段全部 PASS。

## 范围确认

- 未改业务语义
- 仅新增审计与证据文件
