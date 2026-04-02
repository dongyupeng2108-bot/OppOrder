# BTCQDD PROJECT MASTER PLAN（人工维护主计划）

## 0. 计划定位

- 本文档是 BTCQDD 当前人工维护主计划，不再使用“自动快照镜像文档”作为主驱动
- 历史快照模式已降级为历史附录概念，不再作为正文机制
- 本文档用于对齐：
  - 主线目标
  - 当前问题清单
  - 任务推进顺序
  - 测试体系建设路线图

## 1. 项目身份与边界

- 主身份：BTCQDD
- 技术别名：`OppOrder`（repo）、`E:\OppRadar`（本地路径）、`OppRadar`（历史别名）
- 当前主策略：先稳主交易链，再扩功能
- 核心原则：真实运行约束优先于受控样本

## 2. 当前阶段目标（2026 Q1）

- 当前阶段判断：暂停新功能扩展，优先修真实运行 bug + 稳定版本测试 + 保持 UI 简洁可用
- G1：稳定 real runtime 主交易链
- G2：收口窗口生命周期语义与就绪门控语义
- G3：建设轻量一键手动测试体系
- G4：建立高风险不变量长期回归机制

## 3. 当前问题清单（按优先级）

- P0：real runtime 就绪链路稳定性（source/context/bounds/decision）
- P0：窗口基准价冻结语义、边界公式、边界就绪时序
- P1：执行层幂等与窗口隔离持续不回退
- P1：filled_total 真值链与统计口径一致性
- P2：异常发现机制与可观测性增强（作为后续规划项）

## 4. 推进顺序

- 阶段A：定位任务（Truth Audit）
  - 明确 first_break_layer 与可复现证据
- 阶段B：修复验收任务
  - 最小修复，严格 Fail -> Pass
- 阶段C：防回归任务
  - 固化脚本入口、统一回归口径
- 阶段D：增量功能
  - 仅在 A/B/C 收口后推进

流程优化原则：

- 流程与证据强度必须与任务风险匹配
- 轻任务保持轻模板，避免流程成本吞噬主要开发时间
- 重任务保持严格验收链，避免“看似通过”但不可复核
- 仅保留两层口径：轻任务 / 重任务，不引入 T1/T2/T3

### 4.1 治理收口（260329_006 Workflow Upgrade）

- 生效时点：
  - 本任务合并后，下一条新任务起立即执行
  - 不设观察期
  - 已在执行中的任务不做半途切换
- 重任务瘦身（不降质）：
  - 中途禁止反复 Integrate（Dev 阶段只实现与本地验证，Integrate 仅提审前最后一次）
  - 完整 gate 前先过 Fast Gate（语法 / LATEST / scope / 必要证据存在性）
  - 默认采用证据最小提交集，完整 evidence 可生成但不默认进 PR
- mandatory 收口：
  - 轻任务：语法检查 + 修前/修后最小事实块 + LATEST/范围锁/postflight-envelope + `finalize --profile light` + `gate --profile light`
  - 重任务：唯一 first_break_layer + Fail -> Pass + 1组 real runtime + 至少 2 条不回退项 + 改 server 时 healthcheck + `finalize --profile heavy` + `gate --profile heavy`
- gate 分流：
  - light：仅基础治理检查（both），跳过 heavy-only 全局契约与 heavy mandatory 证据
  - heavy：基础治理检查（both）+ heavy-only 全量检查
- 不新增第三分级：仅 light/heavy 两层
- 最小验证硬规则：
  - 任何非纯测试任务必须做与任务直接相关的最小验证
  - 修复任务至少 1 组 Fail -> Pass
  - 涉及运行语义必须至少 1 组 real runtime 样本

## 5. 测试体系建设路线图

### 5.1 目标形态

- 轻量一键手动测试体系（非复杂平台）
- 每个关键模块/关键 Bug 均有对应验证脚本
- 所有脚本归并到总入口，支持版本升级后一键回归

### 5.2 分层路线

- Core CI
  - 持续保证基础健康、证据结构完整
- Manual Packs
  - 面向任务口径的实证验证包（real 主样本 + debug 对照）
- Release Checks
  - 面向发布的关键不变量总检查

### 5.3 验证脚本规范路线

- 统一输入参数（task_id、样本模式、输出路径）
- 统一输出结构（结论块、对账表、证据索引）
- 统一失败语义（first_break_layer、失败原因、阻断点）

### 5.4 Manual 包与五模块映射（索引）

与 [`docs/MODULE_MAP.md`](../../docs/MODULE_MAP.md) 五模块对齐；下列脚本由 [`scripts/verify_all_manual.mjs`](../../scripts/verify_all_manual.mjs) 编排（**总入口**：`node scripts/verify_all_manual.mjs`），归属按**主要验证对象**划分。

| 模块 | `verify_*.mjs`（`verify_all_manual` 清单内） | 说明 |
|------|-----------------------------------------------|------|
| **1 策略输入** | `verify_btc_source_chain.mjs` | 行情 / source chain |
| **1 + 2** | `verify_context_truth.mjs`、`verify_config_effect_chain.mjs` | context 真值与配置效应链（跨输入与引擎） |
| **2 执行引擎** | `verify_window_lifecycle.mjs`、`verify_anchor_bounds_lifecycle.mjs`、`verify_executor_idempotency.mjs`、`verify_order_scope_and_status.mjs` | 窗口 / anchor·bounds / 幂等 / 订单 scope |
| **4 运行结果** | `verify_result_chain_consistency.mjs`、`verify_pnl_chain_consistency.mjs`、`verify_runtime_to_business_result.mjs` | 结果链、PNL、runtime→业务结果 |
| **5 版本测试** | 上述全部 + 总入口 `verify_all_manual.mjs` | 编排、证据落盘、与 [`docs/VERIFY_PLAYBOOK.md`](../../docs/VERIFY_PLAYBOOK.md) 一致 |

未列入总入口的脚本（如 `verify_doc_contract_examples.mjs`、OppRadar 侧 `verify_rank_v2_contract.mjs` 等）仍属 **5** 或文档契约类辅助，以各脚本头注释与 CI 配置为准。

## 6. 高风险约束路线图

长期必须持续验证：

- 未就绪不推进依赖动作
- 非 PLACE_LADDER tick 不新增订单
- 窗口语义不混（current/last/runtime snapshot）
- filled_total 真值链一致
- running 窗口不混入 completed summary
- source/context/ready 链可达
- bounds readiness 独立通过

## 7. 异常发现机制（规划项）

- 目标：把“发现异常”前移到验证脚本和证据摘要层
- 路线：
  - 增加关键结论块趋势监控
  - 增加高风险字段漂移告警
  - 增加 real/debug 分叉自动标注

## 8. 计划维护规则

- 本文档允许人工维护，但必须保持与 WORKFLOW / PROJECT_RULES 口径一致
- 任何大改需以 Workflow Upgrade Task 执行并产出摘要
- 禁止将本文件再次改回“自动快照唯一来源”模式

## 9. 最近已完成里程碑（事实同步）

- `260326_047`：完成 bounds 主链审计，确认 bounds 仍属执行主链，第一断裂层在 `atr_5m` 输入层
- `260326_048`：修复 `anchor_btc` 冻结语义，解耦 window initialized 与 bounds ready；ATR 缺失不再导致 anchor 漂移
- `260326_049`：完成 `260326_048` clean PR 重建并合并
- `260326_050` / `260326_051`：`verify_order_scope_and_status` 最终定性为测试脚本稳定性问题，补强 fresh start 与采样稳定性
- `260327_001`：顶部按钮顺序收口“版本测试 / 重启服务 / 启动”，移除“当前无活动窗口”
- `260327_002`：`BTC价格`、`UPDOWN概率`、`波动值` 搬到“当前窗口订单状态”下方并明确字段来源
- `260327_003`：删除“本轮运行”，精简“上一窗口结果”并新增 `PNL`，移动到实时日志右侧
- `260327_004`：近期表现摘要新增“胜率”；“总已实现盈亏”改为“总计PNL”；PNL 显示 1 位小数

## 10. 下一步优先级建议（按当前阶段）

- P0：真实运行主链连续观察与生命周期稳定性复验（先真实、再脚本）
- P0：版本测试脚本稳定性持续收口（先分类业务/测试，再修复）
- P1：UI 仅做“简洁可用”范围内小步收口，不扩新功能口径
- P2：在 P0/P1 稳定后，再评估增量功能与统计扩展

## 11. 模块化工作路线（索引）

- **模块划分（五模块 + 排障）**：[`docs/MODULE_MAP.md`](../../docs/MODULE_MAP.md)
- **分阶段 M0–M3、M1 门禁（主线 backlog 最新未闭环项）**：[`docs/MODULAR_ROADMAP.md`](../../docs/MODULAR_ROADMAP.md)
- **M 系列状态**：M0–M2 已完成，M3 已取消（不进入当前阶段计划）。
- **C 系列状态**：C1-1 ~ C1-4 已完成（总口径、薄契约、绑定图、变更门槛均已落地）。
- **当前模块化边界**：到 M2 + C1 为止，不继续推进 M3 物理拆分。
- **进展**：以本文档 §12 与 [`docs/BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](../../docs/BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md) 为准。

## 12. 当前项目状态总览（执行真源）

### 12.1 已闭环项

- 模块化 M 系列：M0、M1、M2 全部完成。
- 语义治理 C 系列：C1-1、C1-2、C1-3、C1-4 全部完成。
- 高风险口径治理资产已形成：总口径、五模块薄契约、绑定图、变更门槛。

### 12.2 默认下一步顺序

1. 三大文档同步与执行规则切换
2. 真钱前 UI/BUG 收口
3. 极小额真钱链路验证

### 12.3 冻结项

- M3 物理目录 / 包级拆分：当前冻结并取消，不作为当前阶段任务入口。
- 未经 Owner 新批准，不重启“结构性大拆分”任务。
