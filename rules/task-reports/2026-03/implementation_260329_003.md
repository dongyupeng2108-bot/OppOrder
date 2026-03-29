# TraeTask_260329_003 实施记录（DOWN挂单断裂 + tp_price=1 语义）

## 定位结论

- 唯一 first_break_layer：**输入保存层**
- 修前约束在输入层将 `tp_price` 限制为 `<1`，导致 `tp_price=1` 无法按预期进入执行链，出现“按配置与实际执行不一致”的断裂风险。

## 修复范围

- `ui/js/strategy-editor.js`
- `strategies/crypto_binary/server.mjs`
- `strategies/crypto_binary/bot_strategy.mjs`
- `strategies/crypto_binary/bot_strategy_contract.mjs`
- `strategies/crypto_binary/bot_order_ledger.mjs`
- `scripts/truth_audit_down_entry_and_tp1_semantics_260329_003.mjs`

## 核心修复

- `tp_price` 上限改为 `<=1`（UI/服务端/策略输入契约/账本归一化一致放宽）。
- 默认 `tp_price` 统一改为 `1`（UI 默认档位、服务端默认 config、策略回退梯队、账本回退梯队一致）。
- 执行语义收口：
  - `tp_price=1` 时，ENTRY 可正常挂出与成交；
  - 不自动创建 `TAKE_PROFIT` 预挂单；
  - 该档位按“等待窗口结算”语义处理。
- `tp_price<1` 仍保持逐档 TP 绑定，不回退。

## 结果

- 修后同窗口开局可见 UP/DOWN 两侧 ENTRY 同时挂出。
- `tp_price=1` 可保存、默认值为 1，且不预挂 TP。
- `tp_price<1` 仍正常生成对应 TP 单。
