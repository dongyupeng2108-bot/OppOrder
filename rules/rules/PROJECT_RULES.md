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
- 分层口径锁定：仅使用“轻任务 / 重任务”，禁止新增 T1/T2/T3 等分级名词

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

## 4.1 最小验证硬规则（非纯测试任务）

- 任何非纯测试任务，执行者必须做与任务直接相关的最小验证
- 修复任务至少包含 1 组 Fail -> Pass
- 若涉及运行语义，必须包含 1 组 real runtime 样本
- 不得只交代码改动，不交验证事实

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
- 仅引用文件名/路径不算主证据，关键事实必须进入回报正文最小事实块
- 完整 Integrate 前，必须先过本地 Fast Gate（语法 / LATEST / scope / 必要证据存在性）
- 重任务中途禁止反复 Integrate：
  - Dev阶段只做实现 + 本地验证 + 目标链最小样本
  - Integrate阶段只在提审前最后一次运行 finalize + gate
- 重任务默认最小提交集：
  - 结论块、唯一 first_break_layer、Fail -> Pass 主证据、1组 real runtime 连续样本、至少 2 条不回退项、notify/result、必要 manifest/index、改 server 时 healthcheck
  - 执行命令：`finalize_task_evidence --profile heavy` 与 `gate_light_ci --profile heavy`
- finalize 默认产物（`artifact_mode=minimal`）：
  - 默认保留：`result/notify/truth_audit/evidence_manifest(deliverables_index)/workspace_healer/run/dod/git_meta/healthcheck(命中时)`
  - 默认不生成：`ci_parity`、`errors_jsonl/errors_summary`、`preflight_attestation`
  - 如需完整产物，显式使用 `--artifact_mode full`
  - 该策略不改变 gate_light_ci 判定语义与 light/heavy 定义
- 轻任务默认最小提交集：
  - 相关文件语法检查、修前 1 条 / 修后 1 条最小事实块、LATEST/范围锁/postflight-envelope、finalize/gate 通过结果
  - 执行命令：`finalize_task_evidence --profile light` 与 `gate_light_ci --profile light`

## 7.1 轻任务 / 重任务 mandatory 收口

- 轻任务 mandatory：
  - 相关文件语法检查
  - 最小事实块（修前 1 条、修后 1 条）
  - `finalize_task_evidence`
  - `gate_light_ci`
  - 跳过 heavy-only 检查（全局契约/mocks/heavy mandatory 证据）
- 重任务 mandatory：
  - 唯一 first_break_layer
  - 1组 Fail -> Pass 主证据
  - 1组 real runtime 连续样本
  - 业务 heavy：至少 2 条不回退项（non_regression）
  - Workflow Upgrade / 治理 heavy：治理替代证据（治理结果本身）
  - 业务 heavy 改 server 时附 `GET /` 与 `GET /pairs`
  - 提审前最后一次性跑 `finalize_task_evidence + gate_light_ci`
  - 保留 heavy-only 检查（全局契约 + heavy mandatory 证据）
  - 流程元证据降级为 warn，不再作为 heavy mandatory 阻断项（如 `HEAVY_PARALLEL_START`、profile split 痕迹、gate/finalize 内部流程日志字样）
  - 执行提效允许项（260403_004）：合约校验并行化；Rank/Export/Ledger mock server 单会话复用；不改变覆盖与强制项
  - 执行提效允许项（260403_005）：scanner/universe/trading 统一硬超时 4000ms；命中首个硬失败后 fail-fast 并输出首个失败节点；不改变覆盖与强制项
  - 执行提效允许项（260403_006）：SnippetCommitMustMatch 使用 local-first git 校验；仅本地信息不足时执行最小必要 fetch/deepen；不改变判定语义

## 7.2 生效时点（260329_006）

- 本 Workflow Upgrade Task 合并后，下一条新任务起立即执行
- 不设观察期
- 已在执行中的任务不做半途切换
- 不新增第三分级，仅 light/heavy 两层

## 8. 变更边界

- 业务任务不得改写流程模板与规则模板
- 仅 Workflow Upgrade Task 可改三大文档结构与模板
- 文档升级必须保证三大文档口径一致

## 9. 当前关键语义口径（高优先，分层）

### 9.1 当前默认策略链口径

- `anchor_btc`：同一窗口只冻结一次，不得随 `btc_price` 漂移
- `bounds / bounds_ready`：边界与就绪语义属执行主链，不得按展示字段降级处理

### 9.2 执行主链通用语义

- ATR 缺失行为：系统可 not ready，但不得反复 window init，不得重写 anchor
- `current / active / last`：生命周期语义高风险区，禁止混用改口径

### 9.3 结果真值链口径

- `filled_total`：必须与订单真值链一致（含 unique FILLED 约束）
- PNL 分区口径：
  - 上一窗口结果 `PNL`：上一窗口最终结果值
  - 近期表现摘要 `总计PNL`：阶段汇总值

### 9.4 字段判断四问（必答）

- 它是什么类型（策略链/执行链/结果链）？
- 谁生产？
- 谁消费？
- 是否要求跨模块一致？

未答完四问，不得定性该字段改动为低风险。

## 10. 近期已完成事实（口径锚点）

- `260326_047`：完成 bounds 主链审计，确认 bounds 仍属执行主链，第一断裂层在 `atr_5m` 输入层
- `260326_048`：修复 `anchor_btc` 冻结语义，解耦 window initialized 与 bounds ready；ATR 缺失不再导致 anchor 漂移
- `260326_049`：完成 `260326_048` clean PR 重建并合并
- `260326_050` / `260326_051`：`verify_order_scope_and_status` 最终定性为测试脚本稳定性问题，补强 fresh start 与采样稳定性
- `260327_001`：顶部按钮顺序收口“版本测试 / 重启服务 / 启动”，移除“当前无活动窗口”
- `260327_002`：`BTC价格`、`UPDOWN概率`、`波动值` 搬到“当前窗口订单状态”下方并明确字段来源
- `260327_003`：删除“本轮运行”，精简“上一窗口结果”并新增 `PNL`，移动到实时日志右侧
- `260327_004`：近期表现摘要新增“胜率”；“总已实现盈亏”改为“总计PNL”；PNL 显示 1 位小数
