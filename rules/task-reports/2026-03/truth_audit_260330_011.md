# TraeTask_260330_011 验收摘要（anchor/bounds/bounds_ready 定位）

## 结论

- 验收结论：**未通过（定位任务）**
- verdict：`C：存在断裂`
- 唯一 first_break_layer：`atr_input`
- real/debug：存在分叉，首分叉层=`atr_input`

## 最小事实摘录

- real runtime：
  - 启动窗口与跨新窗口后，`anchor_btc` 有值且同窗不漂移；
  - 但 `atr_5m` 持续为 `null`，`upper/lower` 持续为 `null`，`bounds_ready=false`；
  - 决策停留 `price_or_bounds_null`，`decision_intents=NOOP`。
- debug control：
  - 第 1 步 ATR 缺失：`atr_5m=null`；
  - 第 2/3 步 ATR 到位：`atr_5m=80`，`upper=65096`，`lower=64904`，可进入后续决策。
- 时序对账表：
  - 已输出 `timestamp/current_window_id/anchor_btc/atr_5m/atr_multiple/upper/lower/bounds_ready/decision_reason/decision_intents` 全字段表。

## 范围确认

- 未改 anchor/bounds 业务语义
- 未改下单/撤单/tp/UI/PNL/账户链
- 仅新增审计与证据文件
