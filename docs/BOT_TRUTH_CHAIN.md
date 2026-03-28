# bot 主链唯一真值链（M2-3）

## 一页结论

- 当前执行机器人真值链按固定方向流转：输入真值 -> 执行真值 -> `/bot/*` 对外真值 -> UI/verify/runtime 验收真值。
- 模块化以后，开发可按模块进行，但触碰主链口径时，仍需整链验收。
- 本文档只定义主链“谁生产、谁消费、哪里验收”，不展开平台化或大架构设计。

## 1) 主链起点：策略与运行输入

- 起点对象：`BotContext`、`WindowState`、价格/窗口/ATR 等输入。
- 关键口径：`anchor_btc`、`bounds / bounds_ready`、ATR 缺失行为。
- 起点要求：ATR 缺失可 not ready，但不得反复 window init，不得重写 anchor。

## 2) 主链中段：执行引擎

- 主要链路：runner -> gate -> decision -> ledger。
- 关键口径：`current / active / last`、`filled_total`、窗口生命周期与订单语义。
- 中段职责：把输入与状态机约束转为可审计的决策与订单真值。

## 3) 主链对外面：`/bot/*` API

- 对外主面接口：`/bot/status`、`/bot/context`、`/bot/orders`、`/bot/postmortem/latest`、`/bot/performance/summary`。
- 关键口径：PNL 分区必须分离
  - 上一窗口结果 PNL：窗口最终结果值
  - 近期表现摘要总计PNL：阶段汇总值
- 对外约束：UI 与 verify 只消费这些对外真值，不反向定义后端语义。

## 4) 主链验收面：UI / verify / runtime

- UI 验收：控制台展示仅绑定 `/bot/*` 返回字段，不发明“新真值”。
- verify 验收：`verify_*` 脚本对齐接口与状态语义，失败先分流“业务 vs 测试资产”。
- runtime 验收：真实运行样本用于确认链路在非理想输入下仍符合主链口径。

## 极简链路表

| 链路节点 | 主要生产者 | 主要消费者 | 主要证据 | 是否属于主链高风险口径 |
|---------|------------|------------|----------|------------------------|
| 输入真值（Context/State） | 输入适配与状态初始化 | runner/gate | context 相关 verify + runtime 样本 | 是 |
| 执行真值（decision/ledger） | runner / strategy / executor / ledger | `/bot/status`、`/bot/orders` | 订单与生命周期 verify、日志 | 是 |
| 对外真值（`/bot/*`） | `server.mjs` API 聚合层 | UI、verify、人工验收 | API 契约、UI 对账、postmortem/perf 输出 | 是 |
| 验收真值（UI/verify/runtime） | UI 绑定层、verify 脚本、runtime 样本 | Owner/Dev 验收闭环 | `verify_all_manual`、任务证据文件 | 是 |

## 使用规则（最小）

- 讨论“主链真值”时，默认以上述四段链路为唯一口径，不在旧实例承载层定义新语义。
- 变更若触碰 `anchor_btc`、`bounds_ready`、`current/active/last`、`filled_total`、PNL 分区，必须做整链复核。
- 本文档是 M2-3 的边界说明，不替代 `PROJECT_RULES`、`PROJECT_MASTER_PLAN` 与 API 契约正文。
