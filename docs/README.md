# docs/ 索引（BTCQDD）

**本次批量新增/更新的记账性质**：见 **[`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)**（文档/治理铺底，非业务闭环）。

**进展锚点**：模块化与 Bot 主链文档的**进展**以 **[`rules/rules/PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md)** + **[`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md)** 为准（见 [`MODULAR_ROADMAP.md`](MODULAR_ROADMAP.md)）。

| 文档 | 说明 |
|------|------|
| [SEMANTICS_BINDING_MAP.md](SEMANTICS_BINDING_MAP.md) | C1-3：6 条主链口径的代码/API/UI/verify/runtime 绑定图 |
| [CONTRACT_input.md](CONTRACT_input.md) | C1-2：策略与运行输入模块薄契约（输入/输出/拥有权/禁止项） |
| [CONTRACT_engine.md](CONTRACT_engine.md) | C1-2：执行引擎模块薄契约（生命周期/gate/decision/ledger/幂等） |
| [CONTRACT_monitoring.md](CONTRACT_monitoring.md) | C1-2：实时监控模块薄契约（暴露与展示，不反向定义执行语义） |
| [CONTRACT_results.md](CONTRACT_results.md) | C1-2：运行结果模块薄契约（postmortem/snapshot/performance） |
| [CONTRACT_verify.md](CONTRACT_verify.md) | C1-2：版本测试/保障模块薄契约（横切验证层） |
| [BTCQDD_CORE_SEMANTICS.md](BTCQDD_CORE_SEMANTICS.md) | C1-1：执行机器人 6 条主链核心口径总表（总口径真源入口） |
| [RESULTS_PNL_CONTRACT.md](RESULTS_PNL_CONTRACT.md) | M2-4：运行结果模块 PNL/结果字段薄契约（单窗口 vs 阶段汇总） |
| [BOT_TRUTH_CHAIN.md](BOT_TRUTH_CHAIN.md) | M2-3：bot 主链唯一真值链（输入→执行→`/bot/*`→UI/verify/runtime 验收） |
| [BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md](BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md) | M2-2：bot 正式产品面 vs 旧 strategy 实例承载层边界说明（docs-only） |
| [README_BTCQDD.md](README_BTCQDD.md) | 本地启动、URL、最小验收、权威文档链接 |
| [OWNER_BTCQDD_ONE_PAGER.md](OWNER_BTCQDD_ONE_PAGER.md) | Owner 边界：Bot 主面 vs 旧 strategy 承载层 |
| [MODULE_MAP.md](MODULE_MAP.md) | 五模块 + 子模块 + 排障归因 |
| [MODULAR_ROADMAP.md](MODULAR_ROADMAP.md) | 模块化 M0–M3；M1 门禁 + **M1 CODE 边界**；**M2 须 Owner 明确放行** |
| [P0_WORKSTREAM.md](P0_WORKSTREAM.md) | P0：就绪链 / anchor / bounds，定位→修复→防回归 |
| [BOT_HTTP_CONTRACT.md](BOT_HTTP_CONTRACT.md) | `GET /bot/context`、`GET /bot/status` 字段、null 语义、**`/bot/context` 最小契约/API 事实块** |
| [BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md) | CODE+RUNTIME backlog：**情况 A/B**、Task1 与 plan **完成口径**（Owner 验收） |
| [examples/](examples/) | 契约示例 JSON（与 `npm run verify:doc-contracts` 联动） |
| [VERIFY_PLAYBOOK.md](VERIFY_PLAYBOOK.md) | `verify_all_manual`、失败分流、相关脚本索引 |
| [LIVE_GATES.md](LIVE_GATES.md) | Live 闸门（未来阶段，默认不开启） |
| [DEFERRED_SCOPE.md](DEFERRED_SCOPE.md) | 显式不排期：Radar 产品、通用平台、策略生成/回测 |
| [DELIVERY_REPORT_DOC_GOVERNANCE.md](DELIVERY_REPORT_DOC_GOVERNANCE.md) | **交付说明**：DOC/TEST-light 铺底 vs 业务闭环划界 |
| [CURSOR_REVIEW_MERGE.md](CURSOR_REVIEW_MERGE.md) | **Cursor**：审核与合并流程（无自合并、回报格式） |
| [CURSOR_EXECUTION_REPORTING.md](CURSOR_EXECUTION_REPORTING.md) | **Cursor**：执行与回报规范（完成类型、证据、防幻觉） |
| [truth_audit_anchor_bounds_P0A.md](truth_audit_anchor_bounds_P0A.md) | **Phase A**：anchor/bounds 单主题 Truth Audit |
| [phase_b_resolution_anchor_bounds.md](phase_b_resolution_anchor_bounds.md) | **Phase B**：对应决议（本轮无代码修改） |
| [REGRESSION_anchor_bounds.md](REGRESSION_anchor_bounds.md) | **Phase C**：anchor/bounds 回归辅助说明 |
| [phase_d_backlog.md](phase_d_backlog.md) | **Phase D**：增量 backlog 占位 |

治理真源始终在 **[`rules/rules/`](../rules/rules/)**。
