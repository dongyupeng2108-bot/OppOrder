# 模块化工作路线（M0–M3）

**真源**：阶段目标仍以 [`rules/rules/PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) 与 [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md) 为准；本文档仅收 **模块化** 分阶段与 **门禁**，避免与主计划正文重复。

**进展锚点**：模块化文档进展以 **MASTER PLAN + 主线 backlog** 为准（见 [`docs/README.md`](README.md)）。

---

## M0 — 文档锚点（与主计划同步）

- [`MODULE_MAP.md`](MODULE_MAP.md) 与主计划 **§9 / §10** 已互链（里程碑与下一步 ↔ 模块）。
- [`docs/README.md`](README.md) 索引可定位本路线与模块地图。

**门禁**：不修改 `rules/rules` 内模板类文件，除非走 **Workflow Upgrade Task**（见 `PROJECT_RULES.md` §8）。

---

## M1 — 门禁：当前主线 backlog **最新未闭环项**

- **定义**：以 [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md)（或 Owner 指定的**唯一**主线 backlog）中，**当前仍标记为未闭环 / 待 Owner 认定**的**最新**项为前置；该项闭环或 Owner 认定后，门禁**滚动**到下一项（若存在）。
- **操作**：进入 M1 相关工作前，在 PR/描述中**点名**当前门禁项，避免漂移无记录。
- **聚焦**：truth / `verify_*` / 契约补强仅围绕**该项**需要的模块（见 [`MODULE_MAP.md`](MODULE_MAP.md)）。

**代码边界（硬约束）**：M1 若涉及 **CODE**，**只允许**为当前**未闭环主线项**提供 **最小取证 / 辅助代码**（如 `collect_*`、断言补强、与该项直接相关的窄修复）；**不得**以「模块化」名义**顺手**改动业务主链语义、扩大范围重构或做与当前门禁项无关的代码整理。

---

## M2 — 模块化深化（M1 门禁放行后）

**启动条件（硬约束）**：**默认只有 Owner 明确放行，才能启动 M2。**  
**不得**写成或理解为：主线 backlog **没有**未闭环项即可**自动**进入 M2。 backlog 状态至多作为 **前置讨论材料**，**不能**替代 Owner 对 M2 的**显式批准**。

M2 典型产出（放行后）：[`MODULE_MAP.md`](MODULE_MAP.md) **对外契约要点**（维护版索引）；[`PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) **§5.4** Manual 包与五模块映射。

### M2 串行任务（Owner 已批准启动）

- **Owner 批准**：已明确批准启动 M2；具体 PR / 任务描述可作为书面记录。
- **M2-1（已完成）**：[`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md)「总入口」已互链 [`PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) **§5.4** 与 [`MODULE_MAP.md`](MODULE_MAP.md) **各模块对外契约要点（索引）**（未复制 §5.4 表）。
- **M2-2（已完成）**：新增 [`BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md`](BOT_SURFACE_VS_STRATEGY_INSTANCE_BOUNDARY.md)，明确 bot 正式产品面 vs 旧 strategy 实例承载层边界（docs-only）。
- **M2-3（已完成）**：新增 [`BOT_TRUTH_CHAIN.md`](BOT_TRUTH_CHAIN.md)，明确 bot 主链唯一真值链（输入/执行/API/UI·verify·runtime 验收绑定，docs-only）。
- **M2-4（已完成）**：新增 [`RESULTS_PNL_CONTRACT.md`](RESULTS_PNL_CONTRACT.md)，明确运行结果模块 PNL/结果字段薄契约与单窗口/阶段汇总边界（docs-only）。
- **M2-5 及以后**：**未启动**；需再拆下一条时再更新本列表，**不并行**铺开。

---

## M3 — 物理目录 / 包级拆分（显式降级）

- **仅当** Owner 批准范围锁后启动；默认 **不** 列入当前 Q1 必做。
- 不将「把 `server` 拆成多包」当作 P0/P1 前置。
