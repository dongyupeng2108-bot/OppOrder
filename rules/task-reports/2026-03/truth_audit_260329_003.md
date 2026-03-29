# TraeTask_260329_003 修复验收（DOWN挂单 + tp_price=1）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：DOWN挂单与tp=1语义均已收口`
- first_break_layer：`null`
- 修前唯一断裂层：`输入保存层`

## 最小事实摘录

- 修前事实（Fail）：
  - UI/Server/Ledger 均存在 `tp_price < 1` 的硬限制（不允许 `tp_price=1`）。
  - 该约束导致“配置语义与执行语义不一致”的入口断裂风险。

- 修后事实（Pass）：
  - `tp_price=1` 保存成功，且保存后 `up_ladder/down_ladder.tp_price=1`。
  - 同窗口开局 UP/DOWN 两侧 ENTRY 同时存在（`open_yes>=1 && open_no>=1`）。
  - `tp_price=1` 的已成交 ENTRY 不生成 linked `TAKE_PROFIT`。
  - `tp_price<1` 的已成交 ENTRY 仍生成 linked `TAKE_PROFIT`。

- real runtime：
  - 连续样本 `unique_ticks=19`
  - `max_gap_ms=1163`（无明显卡顿）

- 诊断：
  - `GET / => 200`
  - `GET /pairs => 404`

## 说明

- `tp_price=1` 最终执行语义：该档位不预挂 TP，默认等待窗口结算。
- 未改 signer/余额链。
- 未改 PNL/today。
