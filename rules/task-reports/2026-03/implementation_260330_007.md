# TraeTask_260330_007 实施记录（订单状态表 Owner 表头收口）

## 范围结论

- 本单仅改展示层：
  - `ui/js/strategy-editor.js`
  - `scripts/truth_audit_order_table_owner_header_260330_007.mjs`
- 未改执行主链、未改撮合与撤单执行逻辑。

## 字段可区分性先验核实

- 现有订单字段可稳定区分：
  - 开仓：`kind=ENTRY` + `side=YES/NO`
  - 平仓/止盈子单：`kind=TAKE_PROFIT/EXIT` + `side=YES/NO`
- 因此可稳定映射：
  - `YES / NO / YES平仓 / NO平仓`

## UI 收口内容

- 表头固定为：
  - `订单类型｜UP/DOWN｜价格｜数量｜平仓价｜状态`
- 主展示口径：
  - 开仓 YES -> `订单类型=YES`，`UP/DOWN=UP`
  - 开仓 NO -> `订单类型=NO`，`UP/DOWN=DOWN`
  - `TAKE_PROFIT/EXIT + side=YES` -> `YES平仓`
  - `TAKE_PROFIT/EXIT + side=NO` -> `NO平仓`
- 状态主口径：
  - `OPEN -> 挂单中`
  - `FILLED -> 已成交`（开仓单）
  - `CANCELLED -> 已撤单`
  - 平仓/止盈单 `FILLED -> 已经平仓`

## 不回退确认

- 平仓价去重规则保留（不回退 260330_003）。
- 未改 bot_strategy/bot_runner/bot_order_ledger。
