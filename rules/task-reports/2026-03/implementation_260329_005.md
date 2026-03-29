# TraeTask_260329_005 实施记录（tp_price=1 保存链 + 平仓价展示）

## 定位结论

- 唯一 first_break_layer：**server 校验/归一化层**
- 修前风险点：
  - ladder 行归一化存在静默过滤（无效行被 drop）；
  - 校验层对空结果使用 legacyLadder 静默回退，可能出现“某行消失/整组回默认”。

## 修复范围

- `ui/js/strategy-editor.js`
- `strategies/crypto_binary/server.mjs`
- `scripts/truth_audit_tp1_save_and_close_price_table_260329_005.mjs`

## 核心修复

- server 保存链路加严：
  - 新增 `hasInvalidLadderRowPayload`；
  - 当 `up_ladder/down_ladder` 任一行无效时，直接返回 400（不再静默 drop + 默认回退）。
- UI 参数编辑：
  - 新增档位默认 `tp_price=1`。
- 订单状态表格展示：
  - 表头由 `PnL` 改为 `平仓价`；
  - 行内展示 `close/tp`：主值显示成交价或 tp 价，副行显示 `tp:xxx`。

## 结果

- `tp_price=1` 任意行可保存、回填、重载后仍完整保留，不丢行不重置。
- 新增档位默认 `tp_price=1`。
- 当前窗口订单状态展示改为“平仓价”语义。
- `tp_price<1` 逐档 TP 绑定保持成立。
