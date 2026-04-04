## TraeTask_260404_004 实施记录（UI 展示口径修复）

### 范围与约束
- 仅修改 `ui/js/strategy-editor.js` 的展示文案与字段呈现。
- 未修改 `server.mjs`、执行/统计/结算业务逻辑、`verify_all_manual`、三大文档结构。

### BUG-1 修复（胜率口径）
- 标签从“胜率”改为“窗口胜率”。
- 说明文案明确“窗口胜率按已完成窗口计算，非按成交单数”。
- 保留原计算公式（分母仍为已完成窗口行数），仅改展示表达。

### BUG-2 修复（订单标题作用域）
- 订单区标题改为按 `window_scope.scope` 动态显示：
  - `current_window` -> 当前窗口订单状态
  - `last_window` -> 上一窗口订单状态
  - 其他 -> 无活动窗口订单状态

### BUG-3 修复（价格可解释性）
- 订单价格列标题改为“挂单价/成交价”。
- 价格单元格改为 `o.price / o.fill_price` 形式，已成交可直接看到成交价。
- 本次核查确认订单接口已有 `fill_price` 字段，因此不触发停止条件。

### 不改计算证明
- UI 仍直接读取 summary 数值：
  - `filled_total`、`realized_gross_pnl_total`、`avg_realized_gross_pnl_per_window`。
- 胜率公式仍是 `winNumerator / rows.length`，仅标签与说明修正。
