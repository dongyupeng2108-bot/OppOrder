# 交付说明：文档 / 治理铺底（降级记账）

## 本次完成性质（统一定义）

> **已完成 6 项文档/治理铺底项（DOC / TEST-light），不是 6 个业务闭环任务。**

请勿将下文理解为「P0 已在代码侧完成」「主链问题已修复」「业务已闭环」。

---

## 必须写明的降级说明（三条）

1. **`P0_WORKSTREAM.md` 只是 P0 工作流文档，不等于 P0 real runtime 问题已完成。**
2. **`BOT_HTTP_CONTRACT.md` + example JSON 只是静态契约薄表，不等于真实接口契约已运行态验证。**
3. **`verify:doc-contracts` 只是示例结构校验，不启动 HTTP，不替代 `verify_*` 业务测试。**

---

## 本次 PR 正确定位

- **文档/治理铺底 PR**
- **不是**业务主链任务完成 PR

可合并保留，但**不计入**业务闭环完成数。

---

## 六项逐条重报（类型与边界）

### 1. P0_WORKSTREAM.md

- **完成类型**：DOC + **NOT-CLOSED**
- **本次真实完成内容**：将 MASTER PLAN 中 P0 主题与 WORKFLOW「定位→修复→防回归」写成可读的**工作流与排查顺序**说明；附代码锚点与防回归入口索引。
- **不等于什么**：不等于已执行 Truth Audit、不等于 P0-A/B/C 已在 real runtime 修复、不等于已有 Fail→Pass 业务证据。

### 2. BOT_HTTP_CONTRACT.md + `docs/examples/*.json`

- **完成类型**：DOC + **NOT-CLOSED**
- **本次真实完成内容**：根据 `server.mjs` 整理 `GET /bot/context`、`GET /bot/status` 的字段表与 null 语义说明；提供**静态**示例 JSON 便于 diff 与评审。
- **不等于什么**：不等于对运行中服务做过 HTTP 断言、不等于契约已在所有状态下实测、不等于与前端联调已验收。

### 3. `verify:doc-contracts`（`scripts/verify_doc_contract_examples.mjs` + `package.json` 脚本）

- **完成类型**：TEST-light + **NOT-CLOSED**
- **本次真实完成内容**：校验示例 JSON 可解析且含约定顶层键；作为文档与示例**不漂移**的轻量门禁。
- **不等于什么**：不启动 HTTP、不命中真实 `/bot/*`、**不替代** `verify_*` 业务测试与 `verify_all_manual`。

### 4. VERIFY_PLAYBOOK.md

- **完成类型**：DOC + **NOT-CLOSED**
- **本次真实完成内容**：说明 `verify_all_manual` 总入口用法、失败时「脚本 vs 业务」分流、与 P0 相关脚本索引。
- **不等于什么**：不等于版本测试已全部绿、不等于 `verify_order_scope_and_status` 等脚本问题已消失。

### 5. LIVE_GATES.md

- **完成类型**：DOC + **NOT-CLOSED**
- **本次真实完成内容**：记录未来 Live 闸门与 Owner 定序的**占位说明**；明确默认不开启实盘自动化。
- **不等于什么**：不等于已实现 Live 路径验收、不等于已接真实下单闸门。

### 6. DEFERRED_SCOPE.md + README/索引/.cursor/rules/MODULE_MAP 等引用更新

- **完成类型**：DOC + **NOT-CLOSED**
- **本次真实完成内容**：显式写出搁置范围（Radar 产品、通用平台、策略生成/回测等）；更新 `docs/README.md`、`README_BTCQDD.md`、`.cursor/rules/btcqdd.mdc`、`MODULE_MAP.md` 等交叉引用，便于 Agent/人类导航。
- **不等于什么**：不等于上述搁置项已在产品或代码层「正式关闭」或「已排期实现」。

---

#### 本次完成项（摘要）

- 6 项 **DOC / TEST-light 铺底**（见上表），统一服务于**文档、索引、轻校验、范围说明**。
- **不包含**业务代码主链修改、**不包含** P0 real runtime 修复闭环。

#### 本次未完成闭环项

- **P0 real runtime 修复**：未完成
- **真实 HTTP 契约运行态校验**：未完成
- **业务主链单任务验收**（按 WORKFLOW 的 Fail→Pass + real 证据）：未完成

#### 本次 PR 正确定性

- **文档/治理铺底 PR**
- **可合并，但不计入业务闭环完成数**

---

*本文档用于与「6 个业务任务已完成」类表述划界；与 [`rules/rules/PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) 真源不冲突。*
