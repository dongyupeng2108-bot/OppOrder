# BTCQDD 核心口径总表（C1-1）

## 文档用途

- 本文档是当前执行机器人主链 6 条高风险口径的统一真源入口，用于后续 C1-2 / C1-3 / C1-4 对齐。
- 本文档只收口径定义与边界，不替代代码、API 契约、verify 资产与 runtime 证据。
- 口径绑定索引见 [`SEMANTICS_BINDING_MAP.md`](SEMANTICS_BINDING_MAP.md)。
- 变更门槛说明见 [`SEMANTICS_CHANGE_POLICY.md`](SEMANTICS_CHANGE_POLICY.md)。

## 使用规则

- 文档/静态代码阅读/示例 JSON 不能单独证明口径成立。
- 高风险口径必须绑定代码/API/verify/runtime 才能判定“已成立”。
- 触碰这些口径时，不能只做模块验收，仍需整链验收。

## 主链口径条目

### 1) `anchor_btc`

- 定义：窗口生命周期内用于上下界推导与决策参照的 anchor 真值。
- 来源/生产者：执行引擎状态机（窗口初始化与切换路径）。
- 消费者：bounds 计算、gate/decision、`/bot/context` 与相关验收脚本。
- 口径约束：同一窗口内应保持稳定，切窗后按生命周期规则更新。
- 禁止行为：在非窗口切换语义下重写 anchor，或用 UI 展示值反向覆盖状态真值。
- 真值链：state -> `/bot/context` -> UI/verify/runtime。

### 2) `upper_bound / lower_bound / bounds_ready`

- 定义：基于 anchor 与波动口径形成的上下界，以及 bounds 就绪状态。
- 来源/生产者：执行引擎边界计算与 ready 判定逻辑。
- 消费者：gate、decision、`/bot/status`、`/bot/context`、verify。
- 口径约束：`bounds_ready` 必须与上下界可用性一致，不得出现“界值未就绪但视为可交易”。
- 禁止行为：将临时估算界值当正式 bounds，或把 `bounds_ready` 当可选展示标记。
- 真值链：engine bounds -> `/bot/status|/bot/context` -> verify/runtime。

### 3) ATR 缺失时的系统行为

- 定义：ATR 不可用时系统的 not-ready 与保护行为口径。
- 来源/生产者：输入侧 ATR 供给与执行引擎 readiness/gate。
- 消费者：decision gate、状态 API、验收脚本与运行复盘。
- 口径约束：ATR 缺失可阻断交易准备态，但不得破坏窗口生命周期一致性。
- 禁止行为：ATR 缺失时继续按 ready 路径下单，或为“看起来可用”而跳过保护分支。
- 真值链：input ATR -> readiness/gate -> `/bot/status` -> verify/runtime。

### 4) `current / active / last`

- 定义：窗口时间语义三元组，分别表示当前、激活、上一窗口状态。
- 来源/生产者：执行引擎生命周期管理与窗口切换逻辑。
- 消费者：`/bot/status`、UI 生命周期展示、窗口相关 verify。
- 口径约束：三者语义不可互换，切换时序必须可追溯。
- 禁止行为：用 `last` 充当 `current`，或把 `active` 当历史快照字段。
- 真值链：lifecycle state -> `/bot/status` -> UI/verify/runtime。

### 5) `filled_total`

- 定义：订单成交累计计数真值（按既定订单 scope 统计）。
- 来源/生产者：ledger/执行结果汇总。
- 消费者：状态摘要、结果复盘、订单相关 verify。
- 口径约束：统计口径必须与订单 scope 与状态机一致，避免跨窗口错计。
- 禁止行为：混入不在 scope 的订单或重复累计同一成交事件。
- 真值链：ledger events -> summary/status -> verify/runtime。

### 6) PNL 分区口径

- 定义：单窗口结果 PNL 与阶段汇总总计PNL的分区真值。
- 来源/生产者：`postmortem.latest`（单窗口）与 `performance_summary.realized_gross_pnl_total`（阶段汇总）。
- 消费者：`/bot/postmortem/latest`、`/bot/performance/summary`、UI 结果区块、结果 verify。
- 口径约束：单窗口与阶段汇总必须分区展示、分区验收。
- 禁止行为：将“上一窗口结果PNL”当“总计PNL”，或用总计字段反向覆盖单窗口结果。
- 真值链：postmortem/performance -> `/bot/*` -> UI/verify/runtime。

## 验收原则

- 任一口径变更必须提供代码/API/verify/runtime 四类证据中的最小闭环组合。
- 仅通过文档更新不视为口径变更已验证；需有运行态或脚本态证据支撑。
- 触碰高风险口径时，默认从模块验收升级为整链验收。

## 当前最高优先级口径

- P0：`anchor_btc`、`bounds / bounds_ready`、ATR 缺失保护、PNL 分区。
- P1：`current / active / last` 生命周期一致性、`filled_total` 统计一致性。

## 后续维护规则

- 新增口径必须沿用本模板（定义/来源/消费者/约束/禁止/真值链）。
- C1-2/C1-3/C1-4 仅扩绑定与执行，不反向改写本文档的口径定义。
- 若与 `PROJECT_RULES` 或 API 契约正文冲突，以真源文档和运行证据复核后再更新本文档。
