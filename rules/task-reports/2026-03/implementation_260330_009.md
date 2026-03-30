# TraeTask_260330_009 实施记录（订单状态表 UI 简化）

## 范围结论

- 本单仅改：
  - `ui/js/strategy-editor.js`
  - `scripts/truth_audit_order_table_ui_slim_260330_009.mjs`
- 未改执行主链与撮合/撤单逻辑。

## 渲染链核实

- 订单类型次行来源：`parent_order_id`（父单/子单文案）
- 价格次行来源：`fill_price`（`fill:...`）
- 状态次行来源：`lifecycleCode`（OPEN/FILLED/CANCELLED）
- 平仓价次行来源：`tpIsSettle / closeSubText`（等待结算/结算价/tp）

## UI 收口

- 保持主表头不变：
  - `订单类型｜UP/DOWN｜价格｜数量｜平仓价｜状态`
- 删除弱化附文：
  - 父单/子单
  - fill 子行
  - 英文状态附文
  - 平仓价额外解释
- 状态列仅保留中文主口径：
  - 挂单中 / 已成交 / 已撤单 / 已经平仓
- 平仓价列仅保留单一值：
  - 优先 `tp_price`，否则 `fill_price`，否则 `--`
  - `tp=1` 显示 `1.000`

## 不回退确认

- 260330_007 的主表头与主口径保持：
  - `YES / NO / YES平仓 / NO平仓`
  - `UP/DOWN` 映射不变
