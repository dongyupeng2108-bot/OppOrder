# 薄契约｜运行结果模块

## 模块职责

- 负责 `postmortem`、`last_run_snapshot`、`performance_summary` 的结果表达与查询输出。

## 输入

- 执行结束态、订单与成交结果、窗口结算数据、聚合统计输入。

## 输出

- `/bot/postmortem/latest`、`/bot/performance/summary`、结果相关 snapshot 字段。

## 拥有权

- 拥有结果表达语义（单窗口结果与阶段汇总边界）；不拥有执行决策语义。

## 禁止项

- 禁止反向驱动执行引擎状态或决策。
- 禁止混用“上一窗口结果PNL”与“总计PNL”。

## 依赖接口/字段

- `postmortem.latest`、`last_run_snapshot`、`performance_summary.realized_gross_pnl_total`。

## 对应验证入口

- `verify_result_chain_consistency`、`verify_pnl_chain_consistency`、`verify_runtime_to_business_result`。

## 边界补充

- 触碰 PNL 分区或 summary 真值链时，必须整链验收。
