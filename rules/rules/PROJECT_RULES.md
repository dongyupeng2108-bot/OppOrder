# BTCQDD Project Rules（项目规则）

## 0. 项目身份

- 项目主身份：BTCQDD
- 技术别名：
  - Repo：`OppOrder`
  - Local Path：`E:\OppRadar`
  - 历史别名：`OppRadar`
- 规则：上述别名仅用于技术定位，不得替代 BTCQDD 作为业务主名

## 1. 术语与口径

- real runtime：真实运行链路样本（主依据）
- debug control：受控场景样本（对照依据）
- ready：满足当前阶段推进动作的上下文就绪状态
- source chain：`source init -> source feed -> latest cache -> context read -> ready`
- bounds readiness：`anchor_btc + atr_5m + atr_multiple` 就绪后，`upper/lower` 在时限内出现

## 2. 稳定长期规则（长期有效）

- 一次一单：未完成上一任务 DoD，不得并行发布新业务任务
- 证据先行：结论必须落到证据，不允许“凭描述通过”
- 真实优先：real runtime 是验收主样本，debug 仅作对照
- 最小修复：修复任务仅改目标链路，禁止顺手扩范围
- 停止即回报：命中熔断立即停，先回报再切下一步

## 3. 高风险不变量

- 未就绪时不得推进依赖动作
- 非 `PLACE_LADDER` tick 不得新增订单
- `current_window_id` / `last_window_id` / active runtime snapshot 语义不得混
- `filled_total == unique FILLED order_id count`
- running 窗口不得混入 completed summary
- source/context/ready 链在 real runtime 必须可达
- bounds readiness 必须单独验证，不能被其它通过项替代

## 4. 真实运行约束

- 修复与验收任务必须至少包含一条 real runtime 连续样本
- 审计类任务必须给出 first_break_layer
- 若 real 与 debug 分叉，结论必须解释分叉层，不得“用 debug 代替 real”

## 5. 测试体系规则

### 5.1 分层定义

- Core CI
  - 目标：基础稳定性、证据结构校验
  - 不替代业务修复验收
- Manual Packs
  - 目标：任务口径验证（real + debug + 对账）
  - 产出：结论块、连续样本表、证据索引
- Release Checks
  - 目标：发布前关键不变量与高风险链路收口

### 5.2 一键手动测试体系目标

- 每个关键模块/关键缺陷必须有可复用验证脚本
- 验证脚本汇总到总入口，支持版本升级后一键回归
- 优先保证可定位性与可复核性，而非复杂度

### 5.3 验证脚本统一规范

每个验证脚本必须提供：

- 测试目标
- 样本类型与采样边界
- 真值来源
- 核心测试点
- 通过条件
- 输出规范（结论块 + 对账表 + 证据文件）

## 6. 三类任务的测试要求

- 定位任务
  - 必须：real runtime 连续样本、first_break_layer
  - 可选：debug 对照
- 修复验收任务
  - 必须：Fail -> Pass 主证据、核心回归不回退
  - 必须：real runtime 通过证据
- 防回归任务
  - 必须：固化高风险不变量验证路径
  - 必须：输出稳定回归包/脚本入口

## 7. 证据与门禁规则

- `rules/LATEST.json` 必须与当前 task_id 一致
- 证据文件必须包含任务结论块与可追溯索引
- Gate Light / CI 作为合并前硬门禁
- 禁止通过删减校验项“绕过通过”

## 8. 变更边界

- 业务任务不得改写流程模板与规则模板
- 仅 Workflow Upgrade Task 可改三大文档结构与模板
- 文档升级必须保证三大文档口径一致
