# TraeTask_260330_021 实施记录（当前窗口订单状态字段链真值定位）

## 范围与方式

- 本单仅测试与定位，不做业务修复。
- 未改下单/撤单、strategy/runner 业务语义、UI 文案布局、PNL 计算、账户链。

## 审计脚本

- 新增：`scripts/truth_audit_current_window_order_fields_260330_021.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- 输出：
  - 当前窗口订单状态完整字段清单（DOM 实际提取）
  - real runtime 连续样本（挂单→成交/撤单→窗口切换）
  - debug control 对照
  - 逐字段对账表（含 order_id）

## 字段与来源核对

- 顶部字段：
  - `BTC价格` <- `orders.context_snapshot.btc_price || context.btc_price`（fixed1）
  - `UPDOWN概率` <- `bid_yes/bid_no`（fallback ask，fixed3）
  - `波动值` <- `atr_5m`（fixed3）
- 表头字段：
  - `订单类型 / UP-DOWN / 价格 / 数量 / 平仓价 / 状态`
- 行投影关键：
  - 范围：`window_scope=current_window` 时，仅保留 `resolved_window_id==display_window_id`（或空）
  - 状态：`OPEN=>挂单中`, `FILLED=>已成交|已经平仓`, `CANCELLED=>已撤单`
  - 平仓价：`tp_price || fill_price || --`

## 定位结论

- verdict：`A：通过`
- first_break_layer：`NONE_CHAIN_PASS`
- real/debug：`none`
- 说明：
  - 未见混入旧窗口订单；
  - 未见状态列/平仓价列错投影；
  - 窗口切换后当前窗口区块已切到新窗。
