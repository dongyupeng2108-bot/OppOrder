# 薄契约｜执行引擎模块

## 模块职责

- 承担生命周期、gate、decision、ledger、幂等相关核心语义，并将输入真值转为执行真值。

## 输入

- 输入模块产出的上下文与状态前置值、运行配置、历史执行状态。

## 输出

- 决策结果、订单意图/执行结果、状态流转字段、`/bot/status` 与 `/bot/orders` 所需真值。

## 拥有权

- 独占生命周期、gate、decision、ledger、幂等语义拥有权。

## 禁止项

- 禁止由监控/UI/结果模块反向定义执行语义。
- 禁止绕过生命周期与幂等约束直接写入订单真值。

## 依赖接口/字段

- 关键字段：`anchor_btc`、`upper_bound/lower_bound/bounds_ready`、`current/active/last`、`filled_total`。

## 对应验证入口

- `verify_window_lifecycle`、`verify_anchor_bounds_lifecycle`、`verify_executor_idempotency`、`verify_order_scope_and_status`。

## 边界补充

- 触碰主链口径时，不能只做模块验收，必须整链验收（API/UI/verify/runtime）。
