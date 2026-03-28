# 薄契约｜策略与运行输入模块

## 模块职责

- 提供执行前统一输入上下文（行情、窗口、ATR、订单簿等），并输出可判定 readiness 的输入真值。

## 输入

- 行情源数据、窗口发现结果、ATR 与订单簿采样、运行配置。

## 输出

- `BotContext` 类输入对象、输入 trace、就绪前提字段（含与 bounds/ATR 相关前置值）。

## 拥有权

- 拥有输入采集与装配语义；不拥有执行决策、订单状态与结果统计语义。

## 禁止项

- 禁止反向定义执行语义（gate/decision/ledger）。
- 禁止将展示层派生字段回写为输入真值。

## 依赖接口/字段

- 依赖输入链相关字段（如价格、ATR、窗口标识）与 `/bot/context` 对外呈现。

## 对应验证入口

- `verify_context_truth`、`verify_config_effect_chain`、运行态样本复核。

## 边界补充

- 若触碰主链口径（anchor/bounds、filled_total、runtime 语义），仍需整链验收。
