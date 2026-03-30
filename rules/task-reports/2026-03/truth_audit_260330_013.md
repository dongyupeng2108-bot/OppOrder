# TraeTask_260330_013 验收摘要（atr_input 修复）

## 结论

- 验收结论：**PASS**
- 结论：real runtime 下 `atr_5m` 跨窗后可到位，`upper/lower` 与 `bounds_ready` 可正常成立。
- 唯一 first_break_layer（修前）：`atr_input`

## 最小事实摘录

- 修前（来自 260330_011 真实样本）：
  - 跨窗后仍 `atr_5m=null`、`upper/lower=null`；
  - `decision_reason=price_or_bounds_null`，`decision_intents=NOOP`。
- 修后（本单 real runtime）：
  - 跨窗后 `atr_5m` 到位；
  - 随后 `upper/lower` 出现并 `bounds_ready=true`；
  - 决策进入合法 `PLACE_LADDER(...)`。
- debug control：
  - 仅作对照（null -> non-null），不替代 real runtime 结论。
- 不回退：
  - 同窗 anchor 只冻结一次；
  - 启动窗口仍不挂单。

## 范围确认

- 未改 anchor/bounds 公式语义
- 未改下单/撤单/tp/UI/PNL/账户链
- 仅改 ATR 输入链与本任务审计证据
