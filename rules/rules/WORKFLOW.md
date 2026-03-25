# BTCQDD Workflow（执行流程总则）

## 0. 项目身份与角色契约

- 项目主身份：BTCQDD
- 技术别名：仓库名 `OppOrder`、本地路径 `E:\OppRadar`、历史别名 `OppRadar`（仅用于技术定位，不作为业务主身份）
- 文档主路径（Source of Truth）：`rules/rules/`

角色契约：

- Owner：定义目标优先级、发布节奏、合并决策
- PM：下发任务胶囊、设定范围锁、给出验收口径与停止条件
- Dev：按范围锁执行、提交证据、回报 DoD

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

### 1.3 开发与交付节奏

- Dev阶段：实现与本地验证，可改业务代码
- Integrate阶段：证据汇总、LATEST 对齐、PR 与 CI 收口
- Integrate 期间禁止临时扩 scope 改业务目标

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
- DoD
- 失败时的阻断报告
