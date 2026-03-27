# BTCQDD 模块地图（初稿）

**模块定义**：边界清晰、接口可约定、可单独验证的一块能力。  
本文档与 [`rules/rules/PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) 的测试与优先级一致；文件路径随重构可调整，**契约与语义**以 `PROJECT_RULES` 为准。  
**分阶段路线与门禁**（M0–M3）：[`MODULAR_ROADMAP.md`](MODULAR_ROADMAP.md)。**进展**以 MASTER PLAN + [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md) 为准。
**产品面边界说明**：[`BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md`](BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md)（M2-2，docs-only）。

## 总览：执行机器人五模块

| 模块 | 职责（一句话） | 典型代码落点 |
|------|----------------|--------------|
| **1. 策略输入** | 行情、窗口、订单簿、ATR 等进入系统的统一上下文 | `price_feed.mjs`、`market_scanner.mjs`、`orderbook_monitor.mjs`、`bot_context_adapter.mjs` |
| **2. 执行引擎** | 生命周期、决策、gate、Paper/Live 执行、订单真值 | `bot_state.mjs`、`bot_runner.mjs`、`bot_strategy.mjs`、`bot_executor_paper.mjs`、`bot_order_ledger.mjs`、（Live：`live_executor.mjs`） |
| **3. 运行监控** | 控制 API、日志、控制台 UI | `server.mjs`（`/bot/*`）、`bot_logger.mjs`、`ui/js/strategy-editor.js` |
| **4. 运行结果** | 窗口/阶段 PNL、摘要、postmortem | `postmortem.mjs`、`postmortem_api.mjs`、`server.mjs` 中 performance/paper summary |
| **5. 版本测试** | 护栏脚本、一键回归、证据落盘 | `scripts/verify_*.mjs`、`verify_all_manual.mjs`、`server.mjs` `/bot/test/*` |

**Paper / Live**：执行引擎（及输入侧部分行为）的**模式**，不是与上表并列的第六模块。

---

## 与主计划 §9–§10 的对应关系

与 [`PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) **§9 最近已完成里程碑**、**§10 下一步优先级** 对齐阅读，避免「模块地图」与主计划漂移。

| 主计划段落 | 对应模块侧重（粗粒度） |
|------------|------------------------|
| **§9** 里程碑（bounds/anchor、UI 收口、`verify_order_scope_and_status` 稳定性等） | 以 **2 执行引擎**、**1 策略输入**、**5 版本测试** 为主；UI 相关条目同时涉及 **3 运行监控**。 |
| **§10** P0 真实主链与生命周期复验 | **1 + 2**（source/context/bounds/decision 与窗口语义）。 |
| **§10** P0 版本测试脚本稳定性 | **5**（`verify_*` 与 [`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md) 分流）。 |
| **§10** P1 UI 小步收口 | **3**（`/bot/*` 与控制台；先核对后端真值）。 |
| **§10** P2 增量功能/统计（后续） | 多在 **2 + 4**；启动前须满足主计划 §2 阶段判断。 |

---

## 1. 策略输入模块

### 重要功能

- BTC 价格链（多源、失败语义、缓存/trace）
- 当前 Up/Down **窗口**（slug、5m/15m、剩余时间）
- 订单簿/报价（UPDOWN 概率侧）
- **Context 装配**（`btc_price`、`atr_5m`、`bid/ask`、`anchor/upper/lower` 等与 state 的配合）

### 子模块（逻辑划分）

| 子模块 | 职责 |
|--------|------|
| 行情源 | init/feed/direct_fetch、备源与代理 |
| 窗口发现 | `findCurrentWindow`、slug 前缀 |
| 微观结构 | orderbook snapshot、stale |
| Context 装配 | 对外输出「策略输入」契约（供 runner 使用） |

### 接口思想

对外以 **Context DTO + trace 元数据** 为主，避免引擎直接依赖 scanner 内部实现。

---

## 2. 执行引擎模块

### 重要功能

- 状态机：窗口切换、`anchor_btc` / bounds、phase
- Tick：`decide`、readiness **gating**、PLACE_LADDER 幂等
- Paper：意图 → ledger、成交模拟
- Live（若启用）：真实下单路径，须与 Paper 语义可对齐部分严格区分

### 子模块（逻辑划分）

| 子模块 | 职责 |
|--------|------|
| 生命周期 / 状态 | `bot_state`、`createWindowInitPatch` 等 |
| 决策与门控 | `bot_strategy`、`bot_runner` 中 gate |
| 执行适配 | intents → paper/live |
| 订单真值 | ledger、scope、FILLED 计数 |

### 接口思想

**策略输入（Context）** 进；**订单列表 + summary + 事件** 出。高风险不变量见 `PROJECT_RULES.md` §3、§9。

---

## 3. 运行监控模块

### 重要功能

- HTTP：`/bot/status`、`/bot/context`、`/bot/orders`、`/bot/decision-preview`、`/bot/config` 等
- 结构化日志与查询
- 控制台：轮询、展示、按钮（启动、版本测试等）

### 子模块（逻辑划分）

| 子模块 | 职责 |
|--------|------|
| 控制 API | 对外 HTTP 契约 |
| 可观测性 | 日志、事件类型 |
| 前端控制台 | 仅消费 API，不发明后端语义 |

---

## 4. 运行结果模块

### 重要功能

- 单窗口 / postmortem
- 阶段汇总：PNL、胜率等（口径见 `PROJECT_RULES.md` §9）
- 与 DB、`last_run_snapshot` 的衔接

### 子模块（逻辑划分）

| 子模块 | 职责 |
|--------|------|
| 单窗口结算 | postmortem 真值 |
| 聚合统计 | performance summary |
| 持久化与查询 | sqlite / API 字段 |

---

## 5. 版本测试模块

### 重要功能

- 单主题 `verify_*.mjs`（context、anchor、bounds、幂等、订单 scope、PNL 链等）
- 总入口 `verify_all_manual.mjs`
- UI/服务：`/bot/test/run`、日志与结果路径

### 子模块（逻辑划分）

| 子模块 | 职责 |
|--------|------|
| 场景与样本 | debug / real、sample 名 |
| 断言与真值 | 对齐 status/context/logs |
| 编排与证据 | task_id、落盘、结论块 |

### 接口思想

测试依赖**稳定对外契约**；失败时先区分脚本 vs 业务（见 `PROJECT_RULES` §5）。

---

## 各模块对外契约要点（索引）

| 模块 | 契约与真源（优先阅读） |
|------|-------------------------|
| **1 策略输入** | [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md)（`GET /bot/context` 等字段）；[`PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) 中 source / ready / bounds 相关节。 |
| **2 执行引擎** | `PROJECT_RULES.md` §3、§9（订单、窗口、`filled_total`、PLACE_LADDER 等）；与 Paper/Live 分叉时在 [`LIVE_GATES.md`](LIVE_GATES.md) 查闸门说明。 |
| **3 运行监控** | [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md) 全部 `/bot/*` 最小契约；前端仅消费 API，不发明后端语义。 |
| **4 运行结果** | `PROJECT_RULES.md` §9（PNL/统计口径）；postmortem / summary API 与 DB 字段以代码与契约为准。 |
| **5 版本测试** | [`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md)；`scripts/verify_all_manual.mjs` 编排清单；[`PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) §5.4 与五模块映射。 |

---

## 排障时如何归因

| 现象 | 优先怀疑模块 |
|------|----------------|
| context 缺字段、价格/ATR 不对 | 策略输入 |
| 重复下单、gate 错误、anchor 漂移 | 执行引擎 |
| 页面与接口不一致 | 运行监控（先核对后端真值） |
| PNL/胜率对不上 | 运行结果 + 引擎结束态 |
| 脚本偶发失败 | 版本测试（样本/前置）再怀疑业务 |

---

## 维护说明

- 业务任务**不**改 `rules/rules` 模板；三大文档升级须 **Workflow Upgrade Task**（见 `PROJECT_RULES.md` §8）。
- 模块边界细化时，应同步 **契约（字段表）** 与 **verify 覆盖**，而非仅改本文档标题。
- HTTP 字段与 null 语义：[`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md)；P0 执行顺序：[`P0_WORKSTREAM.md`](P0_WORKSTREAM.md)。
