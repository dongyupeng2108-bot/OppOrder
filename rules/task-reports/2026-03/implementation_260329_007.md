# TraeTask_260329_007 实施记录（新窗口挂单 + 当前窗口状态 + tp=1 展示）

## 定位结论

- 唯一 first_break_layer：**2. 窗口订单归档/过滤层**
- 次级影响链：
  - 展示层旧逻辑优先仅显示 OPEN，导致一侧成交时看起来“缺边”
  - tp=1 平仓价列展示主值/子行可能不一致

## 修复范围

- `strategies/crypto_binary/bot_order_ledger.mjs`
- `strategies/crypto_binary/bot_runner.mjs`
- `strategies/crypto_binary/server.mjs`
- `ui/js/strategy-editor.js`
- `scripts/truth_audit_window_chain_owner_scenario_260329_007.mjs`

## 核心修复

- 在账本订单模型引入 `window_id`（ENTRY/EXIT/TP 均携带）：
  - runner 下单 source 注入 `window` 信息；
  - ledger 从 source 解析窗口并写入订单；
  - tp 订单继承父 ENTRY 的 `window_id`，避免跨窗口混入。
- server 订单归档/过滤改为优先使用 `resolved_window_id`（显式 window_id 优先，推断为后备）。
- 当前窗口状态展示：
  - 不再“有 OPEN 就只显示 OPEN”，改为展示当前窗口全状态；
  - 平仓价列对 `tp=1` 统一展示“等待结算”（子行固定 `tp:1.000`）。

## 结果

- 新窗口状态不再混入旧窗口/旧配置 TAKE_PROFIT。
- 切到下一窗口后，当前窗口状态随窗口切换。
- `tp=1` 语义在状态表展示口径闭合。
- 260329_004（等新窗口再挂单）与 260329_005（tp=1 保存链）未回退。
