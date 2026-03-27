# BTCQDD｜Owner 视角一页纸（摘要）

> 完整叙事见对话与任务记录；本文档供 Cursor / 新人 **5 分钟对齐边界**。细节以 [`rules/rules/PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) 为准。

## 一句话

围绕 **BTC Up/Down** 的 **运行控制台 + Paper 执行框架**。当前阶段是 **收主链、语义、测试、UI**，不是做通用策略平台。

## `server.mjs` 里两条线

| 层级 | 含义 |
|------|------|
| **Bot 段 `/bot/*`** | **正式产品 API 面**：启停、status、context、decision-preview、orders、postmortem、performance、版本测试等。 |
| **旧 strategy 实例**（`instances/*.json`、`--strategy`） | **承载/兼容**：配置与历史装配来源；**不等于**让用户在页面上管理全套策略实例。 |

**默认心智**：**Bot 是主入口**；旧实例是下层承载，**不要**把产品做成「策略配置中心」或顺手做大重构。

## 三层架构（对齐模块）

1. **上层**：页面 + `/bot/*` + 观察 + 结果摘要 + 测试入口。  
2. **中层**：runner、state、context adapter、readiness/gating、executor、生命周期。  
3. **下层**：strategy 实例、instances、历史兼容。

**原则**：保护上层契约，稳定中层语义，**谨慎**动下层承载；边界更模糊时先别做。

## 与「模块」的对应

执行机器人可拆为五块：**策略输入**、**执行引擎**、**运行监控**、**运行结果**、**版本测试**（见 [`MODULE_MAP.md`](MODULE_MAP.md)）。**Paper / Live** 是运行模式，贯穿执行引擎，不是第六个并列产品模块。

## 禁止误解

- 有 instances ≠ 要做策略管理平台。  
- server 里还有旧结构 ≠ 要统一重构整文件。  
- Bot ≠ 旧 strategy 上的薄壳；**验收以 Bot 为主**。  
- 前端删掉某字段 ≠ 后端语义可删（典型：**bounds** 仍属执行主链）。

## 高风险区（勿顺手改）

见 `PROJECT_RULES.md` §3、§9：`anchor_btc`、bounds/window init/ATR、current/last/订单 scope、`/bot/*` 对 UI 的契约。

## 一句话结论

> **`server.mjs` 的 bot 段 = 正式产品面；旧 strategy 实例体系 = 承载与兼容。优先保护 bot 主链，勿把项目带回「通用策略平台化」。**
