# BTCQDD Workflow（执行流程总则）

## 0. 项目身份与角色契约

- 项目主身份：BTCQDD
- 技术别名：仓库名 `OppOrder`、本地路径 `E:\OppRadar`、历史别名 `OppRadar`（仅用于技术定位，不作为业务主身份）
- 文档主路径（Source of Truth）：`rules/rules/`

角色契约：

- Owner（用户）：定义目标优先级、发布节奏、合并决策
- ChatGPT（项目顾问）：提供架构建议、验收口径建议、风险识别与回归建议；不以“重流程 PM”角色阻塞开发推进
- Dev（执行端）：按范围锁执行、提交证据、回报 DoD；执行端可为 Trae，也可迁移到 Cursor，不绑定单一工具

## 1. 核心流程

### 1.1 一次一单（One-at-a-time）

- 上一个任务未正式回报 DoD（达成/未达成）前，不得发布下一个 TraeTask
- 任务执行必须绑定唯一 task_id（`YYMMDD_NNN`）
- 不允许并行推进多个业务任务共用同一套证据

### 1.2 任务类型与执行顺序

- 定位任务（Truth Audit）
  - 目标：定位断裂层与口径偏差，不修功能
  - 产物：连续样本、对账表、结论块、first_break_layer
- 修复验收任务（Fix + Acceptance）
  - 目标：最小修复 + 同口径验收通过
  - 产物：修复代码、验收证据、回归证据
- 防回归任务（Regression Guard）
  - 目标：固化高风险约束，防止历史问题回流
  - 产物：验证脚本或验证包、稳定回归口径
- Workflow Upgrade Task
  - 目标：升级任务模板/治理规则/文档结构
  - 产物：三大文档升级与一致性证明

标准顺序：

- 先定位
- 再修复验收
- 最后防回归固化

### 1.4 轻任务 / 重任务分流

- 轻任务（默认轻模板）
  - 适用范围：UI/文案/布局、纯测试脚本稳定性、clean PR、只读审计
  - 验收要求：最小目标 + 范围锁定 + 字段来源 + DOM/日志/接口事实块
  - 证据强度：不要求重证据链，不要求截图
- 重任务（严格链路）
  - 适用范围：真实运行 bug、生命周期、状态机、订单语义、影响模拟 vs 实盘一致性逻辑、版本测试主链修复
  - 验收要求：定位 -> 真实运行复验 -> 测试脚本沉淀
  - 证据强度：必须有可复核证据链与 Fail -> Pass
- 分级口径锁定：
  - 仅允许使用“轻任务 / 重任务”两层
  - 禁止引入 T1/T2/T3 等新增分级名词

### 1.5 记账与执行规则切换（当前生效）

- 任务完成类型必须分开记账：
  - 文档项完成
  - 测试辅助完成
  - 业务闭环
- 轻任务走轻验收，重任务走严验收，禁止一刀切流程强度。
- 现状不清时先对齐事实，再做规划与任务拆解。

### 1.3 开发与交付节奏

- Dev阶段：实现与本地验证，可改业务代码
- Integrate阶段：证据汇总、LATEST 对齐、PR 与 CI 收口
- Integrate 期间禁止临时扩 scope 改业务目标
- 重任务中途禁止反复 Integrate：
  - Dev阶段只做实现 + 本地验证 + 目标链最小样本
  - Integrate阶段只在提审前最后一次运行收尾链
  - 收尾链固定为：
    - 轻任务：`node scripts/finalize_task_evidence.mjs --task_id <task_id> --profile light`
    - 重任务：`node scripts/finalize_task_evidence.mjs --task_id <task_id> --profile heavy`
    - 两者最终都必须执行 gate，但 gate 按 profile 执行不同检查集

### 1.6 即刻生效规则（260329_006）

- 本次 Workflow Upgrade Task 合并后，从下一条新任务起立即执行新规则
- 不设观察期
- 已在执行中的任务不做半途切换

### 1.7 Git 事实流转（260405_001）

- 从 `260405_001` 起，任务定义采用固定目录：
  - `docs/tasks/<task_id>.md`
- 任务回报与证据目录保持不变：
  - `rules/task-reports/YYYY-MM/<task_id>/...`
- 当前任务指针保持不变：
  - `rules/LATEST.json`

执行顺序：

- Owner 以需求口径冻结任务目标
- Dev 按模板生成并提交 `docs/tasks/<task_id>.md`
- Owner 确认任务文件后开始执行
- Dev 完成后将回报与证据写入 `rules/task-reports/...`
- Dev 提交 PR 后，通知 Owner 进入外部验收（ChatGPT）
- Owner 将 `task_id` 或 `PR` 号提交给 ChatGPT 执行验收
- ChatGPT 验收读取顺序固定为：
  - `docs/tasks/<task_id>.md`
  - `rules/LATEST.json`
  - `rules/task-reports/YYYY-MM/<task_id>/...`
  - PR 与 gate 状态

强约束：

- 外部验收（ChatGPT）以 Git 事实为准，不以聊天转述为主证据
- gate 失败一票否决，不得进入合并结论
- 任务仍执行一次一单规则，不并发推进业务任务

## 2. 范围锁与变更纪律

- 每个任务必须显式列出：
  - 允许修改文件
  - 允许新增文件
  - 禁止修改文件
- 文件变更必须与任务目标强相关，禁止“顺手修复”
- 若发现必须重构主链，立即触发停止条件并回报阻断点

## 3. 测试体系总则

### 3.1 测试哲学

- 测试包是护栏，不替代真实修复验收
- 高风险问题必须覆盖受控样本与 real runtime 约束
- 结论必须可追溯到证据文件，不允许口头通过
- 测试失败不等于业务失败，必须先区分：业务 bug / 测试资产 bug / 两者同时存在
- 新测试认知优先沉淀为版本测试脚本与总入口，不只停留在口头结论

### 3.2 分层体系

- Core CI
  - 目标：保证基础可运行性与证据结构正确
  - 典型内容：语法检查、基础行为测试、Gate Light
- Manual Packs
  - 目标：按任务口径进行可复核审计与验收
  - 典型内容：real runtime 连续样本、debug 对照、对账表
- Release Checks
  - 目标：发布前的关键链路与高风险不变量确认
  - 典型内容：核心不变量复核、关键回归打包

### 3.3 一键手动测试体系

- 目标不是复杂测试平台，而是轻量一键手动回归体系
- 要求：
  - 每个关键模块或关键 Bug 修复，必须有对应验证脚本
  - 验证脚本最终纳入统一总入口
  - 版本更新后可手动执行一键总测试

### 3.4 验证脚本统一规范

每个验证脚本必须包含：

- 测试目标
- 样本类型（debug / real runtime / stopped / running / finished）
- 真值来源（status/context/decision-preview/logs/DB等）
- 核心测试点
- 通过条件
- 输出格式（结论块、证据文件、对账表）

### 3.5 证据最小化原则（默认）

- 默认不使用截图作为验收证据
- 优先证据类型：日志、接口返回、DOM 文本、测试结果、最小事实块
- 仅在文本证据不足以表达界面/状态差异时，才补充截图

### 3.6 提交前固定动作（Integrate 前）

- 完整 gate 前必须先过 Fast Gate（本地）：
  - 相关文件语法
  - `rules/LATEST.json`
  - scope/range lock
  - 必要证据文件存在性
- Fast Gate 通过后，才进入完整 Integrate。
- 先运行：`node scripts/finalize_task_evidence.mjs --task_id <task_id>`
- 再运行：`node scripts/gate_light_ci.mjs --task_id <task_id> --result_dir rules/task-reports/<YYYY-MM>`
- 若第二步未通过，不得进入 PR 收口结论。

### 3.7 最小验证硬规则（非纯测试任务）

- 任何非纯测试任务，执行者必须做与任务直接相关的最小验证
- 修复任务至少包含 1 组 Fail -> Pass
- 若涉及运行语义，必须包含 1 组 real runtime 样本
- 不得只交代码改动，不交验证事实

### 3.8 证据最小提交集（默认进 PR）

- 允许生成完整 evidence，但默认进 PR 采用最小必需集
- finalize 默认产物策略（artifact_mode=minimal）：
  - 默认最小产物：`result`、`notify`、`truth_audit`、`evidence_manifest`/`deliverables_index`、`workspace_healer`、`run`、`dod_evidence`、`git_meta`、命中时 healthcheck（`*_healthcheck_53122_root/pairs`）
  - 仅按需/非默认产物：`ci_parity_*`、`errors_*`、`errors_summary_*`、`preflight_attestation_*`
  - 本策略不改变 gate 判定语义；仅收缩 finalize 默认生成集合
- 重任务默认最小提交集至少包括：
  - 结论块
  - 唯一 first_break_layer
  - Fail -> Pass 主证据
  - 1组 real runtime 连续样本
  - 至少 2 条不回退项
  - notify/result
  - 必要 manifest/index
  - 改 server 时 healthcheck（`GET /` 与 `GET /pairs`）
- 轻任务默认最小提交集至少包括：
  - 相关文件语法检查结果
  - 修前 1 条 / 修后 1 条最小事实块
  - LATEST 一致性、范围锁、postflight/envelope 必要校验
  - finalize 与 light gate 通过结果（不触发 heavy-only 全局契约检查）

### 3.9 Light / Heavy Gate 差异

- both：
  - LATEST 一致性、报告块、workspace_healer、doc path、scope lock、postflight/envelope、healthcheck 证据
- light-only：
  - 允许跳过与任务无关的全局契约与 mock server 校验（news/rank/export/ledger/scanner/universe/trading）
- heavy-only：
  - heavy 静态 domain：
    - 默认：`--profile heavy` 等价 `--domain btcqdd`
    - 显式可选：`--domain btcqdd|opportunities|global|full`
    - 非自动触发：不按 changed files/diff/path 自动扩展检查域
  - 默认 `btcqdd` 域不执行跨域 pack（news/rank/export/ledger/scanner/universe/trading、Rank V2 Contract Version Guard）
  - 显式 `opportunities|full` 时执行跨域 contract pack（news/rank/export/ledger/scanner/universe/trading + Rank V2 Contract Version Guard）
  - `global` 为显式静态域保留位（当前仅运行 btcqdd_core，不自动拉起 opportunities pack）
  - heavy mandatory（业务 heavy）：
    - 唯一 first_break_layer
    - Fail -> Pass
    - real runtime
    - non_regression（不回退）
    - 若改 server：healthcheck（`GET /` 与 `GET /pairs`）
  - heavy mandatory（Workflow Upgrade / 治理 heavy）：
    - 唯一 first_break_layer
    - Fail -> Pass
    - real runtime
    - 治理替代证据（治理结果本身）
  - 流程元证据降级为 warn（不再作为 heavy 阻断项）：
    - `HEAVY_PARALLEL_START`
    - profile split 痕迹（`light_only` / `heavy_only` / `workflow profile split`）
    - gate/finalize 内部流程日志字样
    - 其他“为了证明门禁而生成的门禁证据”
  - 执行提效允许项（260403_004）：并行执行 + Rank/Export/Ledger mock server 单会话复用；不得减少覆盖项与强制项
  - 执行提效允许项（260403_005）：scanner/universe/trading 统一硬超时 4000ms；heavy 命中首个硬失败后 fail-fast 并输出 FIRST_FAILED_STAGE/FAIL_FAST_ABORTED/SKIPPED_AFTER_FAIL
  - 执行提效允许项（260403_006）：SnippetCommitMustMatch 采用 local-first git 策略，仅本地信息不足时最小必要 fetch/deepen，并输出 SNIPPET_GIT_STRATEGY/SNIPPET_GIT_FETCH_NEEDED

## 4. 高风险约束执行规则

- 未就绪时不得推进依赖动作
- 非 `PLACE_LADDER` tick 不得新增订单
- `current_window_id` 与 `last_window_id` 语义不得混用
- `filled_total == unique FILLED order_id count`
- running 窗口不得混入 completed summary
- real runtime 下 source/context/ready 链必须可达
- bounds readiness 必须独立验收，不得被 debug 可过替代

## 5. 推进与停止规则

### 5.1 何时允许推进下一任务

- 当前任务已有正式回报
- 回报中明确 DoD 达成/未达成
- 若未达成，已给出 first_break_layer 与下一步建议

### 5.2 停止条件

- 命中任务定义的时间熔断
- 样本不足且无法补齐
- 若继续需要大范围重构
- 若出现 scope lock 冲突或 source-of-truth 路径冲突

命中停止条件后必须立即回报：

- 当前分支
- 已完成项
- 未完成阻断点
- `git diff --name-only`
- 关键日志摘录

## 6. 回报模板（标准）

- 任务ID
- PR
- Gate Light / CI
- 修改文件
- 结论块（按任务要求）
- 证据索引
- 最小事实块（直接正文摘录日志/json/jsonl/API 关键行，文件路径仅作索引）
- DoD
- 失败时的阻断报告

回报落盘要求（260405_001）：

- 每个任务必须存在 `docs/tasks/<task_id>.md`
- 回报与证据必须写入 `rules/task-reports/YYYY-MM/<task_id>/...`
- 聊天中的回报仅做摘要，Git 文件是验收真源
- Dev 必须推进到 PR 阶段后再通知 Owner 发起 ChatGPT 验收

补充规则：

- 若回报引用 log/json/jsonl/API 输出，必须贴最小事实块，不能只贴文件名。
- 真钱验证任务必须单独立项，禁止与 UI/BUG 修复混在同一任务。
