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
- 流程强度匹配风险：高风险任务走重验收链，低风险任务走轻模板，避免流程吞噬主要开发时间

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
- 当前阶段原则：暂停新功能扩展，优先修真实运行 bug + 稳定版本测试 + 保持 UI 简洁可用
- 开发优先级：先稳，再扩；先真实运行主链，再扩功能

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
- 测试失败分类：必须区分业务 bug / 测试资产 bug / 两者同时存在，禁止将测试失败直接等同业务失败
- 测试认知沉淀：新发现优先落地为版本测试脚本与事实输出

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

## 9. 当前关键语义口径（高优先）

- `anchor_btc`：同一窗口只冻结一次，不得随 `btc_price` 漂移
- `bounds`：即便前端已弱化/移除展示，仍属于执行主链，不得按纯展示字段处理
- ATR 缺失：系统可 not ready，但不得反复 window init，不得重写 anchor
- PNL 口径分区：
  - 上一窗口结果 `PNL`：上一窗口最终结果值
  - 近期表现摘要 `总计PNL`：阶段汇总值
- `current / active / last` 语义是高风险区，禁止随意改口径

## 10. 近期已完成事实（口径锚点）

- `260326_047`：完成 bounds 主链审计，确认 bounds 仍属执行主链，第一断裂层在 `atr_5m` 输入层
- `260326_048`：修复 `anchor_btc` 冻结语义，解耦 window initialized 与 bounds ready；ATR 缺失不再导致 anchor 漂移
- `260326_049`：完成 `260326_048` clean PR 重建并合并
- `260326_050` / `260326_051`：`verify_order_scope_and_status` 最终定性为测试脚本稳定性问题，补强 fresh start 与采样稳定性
- `260327_001`：顶部按钮顺序收口“版本测试 / 重启服务 / 启动”，移除“当前无活动窗口”
- `260327_002`：`BTC价格`、`UPDOWN概率`、`波动值` 搬到“当前窗口订单状态”下方并明确字段来源
- `260327_003`：删除“本轮运行”，精简“上一窗口结果”并新增 `PNL`，移动到实时日志右侧
- `260327_004`：近期表现摘要新增“胜率”；“总已实现盈亏”改为“总计PNL”；PNL 显示 1 位小数
