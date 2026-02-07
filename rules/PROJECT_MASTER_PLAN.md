# Opportunity Radar (机会雷达) Master Plan

## Positioning & Slogan
**Slogan**: 信息透明化 + 把概率可验证化 + 把决策流程标准化

**Value Proposition (我们为“预测市场用户”提供)**:
- 信息聚合→证据结构化→概率输出→可复盘回放
- 每次推荐必须可追溯：输入/特征/模型版本/输出/日志/回放/导出证据
- 目标是把“判断过程”产品化，而不是保证收益

**Boundaries & Principles (边界与原则)**:
- 仅使用公开信息与市场数据；不承诺收益；输出只是观点/概率
- 保留审计日志与证据包；支持回测/校准/纠错
- 风控与合规优先：避免诱导性表达与“赌场化”宣传

## M0: Bootstrap (DONE)
- **Status**: DONE.
- **Deliverables**: Infrastructure, Gate Light, Evidence Envelope, Healthcheck.

## M1: Core Data & Strategy (DONE)
- **Status**: DONE.
- **Deliverables**: Data ingestion, Strategy definition, Backtest engine (v3.9).

## M2: Live Trading & Validation (DONE)
- **Status**: DONE.
- **Deliverables**: Diff API/UI, Replay API/UI, Fail-fast evidence.

## M3: Export & Analytics (DONE)
- **Status**: DONE.
- **Deliverables**: Enhanced JSON export, CSV export for analysis.

## Roadmap (路线图)
**Phase Guidelines (阶段路线提示)**:
- 前期用商用模型跑通闭环与数据标准化；后期可切换本地/自训模型
- 关键资产：可验证数据集（事件→特征→概率→结果）与评测体系

把剩余工作拆成 里程碑 → PR（最小可验收单元），后续开发按此推进。

### Milestone M4: 扫描工程化 (Scanning Engineering)
**目标**: 提升扫描能力与效率（增量/缓存/并发/限流/错误隔离/可观测）。
- **PR 1: M4: scan cache (v0)**
  - **目标**: 实现基础扫描缓存，避免重复计算。
  - **DoD**: 相同参数的连续两次扫描，第二次耗时减少 > 80%。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR1_cache_smoke.txt` (记录两次扫描耗时对比)。
- **PR 2: M4: concurrent scan engine**
  - **目标**: 支持多品种/多时间周期并发扫描。
  - **DoD**: 支持至少 3 个并发任务不阻塞。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR2_concurrent_log.txt`。
- **PR 3: M4: scan observability & health**
  - **目标**: 增加扫描过程的可观测性（日志、进度、错误隔离）。
  - **DoD**: 单个品种扫描失败不影响全局，且有明确错误报告。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR3_error_isolation.txt`。

### Milestone M5: 机会算法+LLM (Algo & DeepSeek)
**目标**: 机会路由、结构化输出、成本控制、DeepSeek 调用。
- **PR 1: M5: LLM router & structured output**
  - **目标**: 实现机会路由到 LLM (DeepSeek) 并获取结构化 JSON。
  - **DoD**: 成功将 Opportunity 转换为标准 JSON 格式 (DeepSeek V3/R1)。
  - **证据要求**: `rules/task-reports/2026-02/M5_PR1_llm_json.txt`。
- **PR 2: M5: cost gate & fallback**
  - **目标**: 增加成本控制闸门与降级逻辑。
  - **DoD**: 达到预设成本阈值后自动切换到低成本模型或停止。
  - **证据要求**: `rules/task-reports/2026-02/M5_PR2_cost_gate.txt`。

### Milestone M6: 证据导出与稳定性 (Evidence & Stability)
**目标**: 调试日志标准化、验收证据自动化、运行稳定性增强。
- **PR 1: M6: evidence export standard**
  - **目标**: 统一调试日志与验收证据的导出格式。
  - **DoD**: 生成包含完整上下文的调试包。
  - **证据要求**: `rules/task-reports/2026-02/M6_PR1_evidence_pack.zip`。
- **PR 2: M6: runtime stability**
  - **目标**: 内存泄漏检测、长时间运行稳定性加固。
  - **DoD**: 连续运行 24h 无崩溃 (Mock 环境模拟)。
  - **证据要求**: `rules/task-reports/2026-02/M6_PR2_stability_report.txt`。

## PR Granularity & Milestone Splitting (补充)
- **Granularity**: A set of features = 2~4 Development Phase commits + 1 Integration Phase PR.
- **Priority**:
    1.  **Scanning (扫描)**: M4 (Cache, Concurrent, Observability).
    2.  **Scoring (评分)**: M5 (Baseline Score, DeepSeek Call, Cost Control).
- **Repo Cost KPI**:
    - Weekly Stats (Manual/Scripted):
        - PR Count
        - Conflict Count
        - Rebase/Reset Count
        - Evidence Generation Count (Goal: 1 per PR)

## Engineering Standards
### Stability First
- **Protocol**: If environment commands (e.g., `cd /d` failure) cause task failures, **STOP feature dev**.
- **Action**: Fix the workflow/docs (Docs-only task) to ensure cross-environment compatibility before resuming business logic.

### Noise Reduction
- **Principle**: Minimize "Duplicate PRs" and "Duplicate Task IDs".
- **Standard**: 
  - PR granularity should be small, but `task_id` CANNOT be reused for new PRs if the previous one was merged.
  - A Duplicate PR (re-pushing same task_id evidence) is considered a **Process Defect**.
  - Always run `scripts/pre_pr_check.mjs` to fail-fast before creating a PR.

## Execution & Acceptance Conventions
- **Command Templates**: All tasks MUST use the standard command templates defined in `rules/WORKFLOW.md` (ENV=PowerShell|bash). `cd /d` is strictly prohibited.
- **Evidence**: All PRs must include standard evidence artifacts (Healthcheck, Envelope, Postflight).

<!-- smoke -->
