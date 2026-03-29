# TraeTask_260329_005 验收摘要（tp_price=1 保存与平仓价展示）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：tp_price=1 保存与回填、平仓价展示已收口`
- 修前唯一断裂层：`server 校验/归一化层`
- first_break_layer：`null`

## 最小事实摘录

- 修复前（Fail）：
  - server 存在静默 drop + legacy 默认回退路径（可触发行消失或整组回默认风险）。
  - 表头仍为 `PnL`；新增档位默认 `tp_price` 不是 1。

- 修复后（Pass）：
  - `tp_price=1` 保存成功且行数完整保留（up 3/3，down 2/2）。
  - 重载后仍完整回填（up 3/3，down 2/2）。
  - 新增档位默认 `tp_price=1`。
  - 表头为 `平仓价`，行内含 `tp:` 子行。
  - `tp_price<1` 仍生成 linked `TAKE_PROFIT`。

- 诊断：
  - `GET / => 200`
  - `GET /pairs => 404`

## 说明

- `tp_price=1` 最终语义：等待窗口结算，不预挂 TP。
- 未改 signer/余额链，未改 PNL/today。
