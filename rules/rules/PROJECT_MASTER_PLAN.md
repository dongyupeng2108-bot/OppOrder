# Opportunity Radar (机会雷达) Master Plan

## Project Snapshot (项目快照)
**Current Status**: M3 Completed, entering M4.
**Core Metrics**:
- **Coverage**: 5 Assets (Gold, Silver, MES, MNQ, BTC).
- **Architecture**: Node.js + SQLite (Timeline) + LLM (DeepSeek/Mock).
- **Reliability**: 100% Evidence Coverage (Healthcheck/Envelope/Postflight).

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

## Competition & Differentiation (竞争与差异化)
**Competitors**:
- **Signal Groups**: Subjective, non-verifiable, often "black box".
- **Algo Bots**: Opaque logic, "trust me" PnL, curve-fitting risks.
- **General AI**: Generic advice, lacks domain-specific structure (Monitor/Trigger/Re-eval).

**OppRadar Differentiation**:
1.  **Process Productization**: We sell the *standardized decision process*, not just the result.
2.  **Verifiability**: Built-in "Time Machine" (Replay) and "Audit Trail" (Evidence).
3.  **Data-First**: Accumulating a proprietary "Reasoning Dataset" for future local model training.
4.  **Fail-Fast**: Engineering culture of immediate error detection and isolation.

## M0: Bootstrap (DONE)
- **Status**: DONE.
- **Deliverables**: Infrastructure, Gate Light, Evidence Envelope, Healthcheck.
- **Enhancement**: Mechanize Trae Report Snippet & Gate Enforcement (Task 260209_005).

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

### Milestone M4: Scanning Engineering & Data Enrichment
**目标**: 提升扫描能力、效率与数据丰富度（News, Cache, Concurrent）。
- **PR 0: M4: News & Timeline Integration (DONE - 260208)**
  - **Status**: Completed via Task 017/018.
  - **Deliverables**: NewsProvider, Timeline SQLite DB, News-Reeval Linking.
- **PR 1: M4: scan cache (v0)**
  - **目标**: 实现基础扫描缓存，避免重复计算。
  - **DoD**: 相同参数的连续两次扫描，第二次耗时减少 > 80%。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR1_cache_smoke.txt` (记录两次扫描耗时对比)。
- **PR 2: M4: concurrent scan engine (DONE - 260209)**
  - **Status**: Completed via Task 260209_004.
  - **Deliverables**: `POST /scans/run_batch` API, Concurrency Control (limit 5), Fail-soft Isolation.
  - **目标**: 支持多品种/多时间周期并发扫描。
  - **DoD**: 支持至少 3 个并发任务不阻塞。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR2_concurrent_log.txt`。
- **PR 3: M4: scan observability & health**
  - **目标**: 增加扫描过程的可观测性（日志、进度、错误隔离）。
  - **DoD**: 单个品种扫描失败不影响全局，且有明确错误报告。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR3_error_isolation.txt`。
- **PR 4: M4: Top Opportunities & Gate Exit Mechanization (DONE - 260209)**
  - **Status**: Completed via Task 260209_010.
  - **Deliverables**: `GET /opportunities/top?run_id=...`, mechanized GATE_LIGHT_EXIT (stdout/notify/result), automated DoD evidence.
  - **目标**: 实现基于 run_id 的机会筛选与自动化验收流程。
  - **DoD**: 成功通过 run_id 筛选并生成标准化验收证据，Gate Exit Code 自动化注入。
  - **证据要求**: `rules/task-reports/2026-02/opps_top_by_run_smoke_260209_010.txt`.
- **PR 5: M4: Opportunity Pipeline v1 (DONE - 260210)**
  - **Status**: Completed via Task 260210_006.
  - **Deliverables**: `POST /opportunities/build_v1`, Batch Scan + Fixed Weight Scoring, UI "Build v1" Button.
  - **目标**: 集成并发扫描与基础评分，形成 v1 流水线。
  - **DoD**: 完整跑通 Scan -> Score -> Top 流程，Gate Light 验证通过。
  - **证据要求**: `rules/task-reports/2026-02/opps_pipeline_smoke_260210_006.txt`.

### Milestone M_Hardening: Workflow & CI Stability (Feb 10)
**目标**: 固化工作流协议，消除验证漂移，强制 CI 一致性。
- **Task 260210_001: Message Header Protocol (DONE)**
  - **Deliverables**: WORKFLOW.md protocol, TraeTask header enforcement.
- **Task 260210_002: Communication Mode Separation (DONE)**
  - **Deliverables**: Standard vs Maintenance mode protocol.
- **Task 260210_003: Duplicate Task ID Hard Guard (DONE)**
  - **Deliverables**: `pre_pr_check.mjs` fail-fast on duplicate task_id in main.
- **Task 260210_005: Gate Light Evidence Truth (In Progress)**
  - **Goal**: Ensure snippet exit code matches real log exit code.
- **Task 260210_007: CI Lock PR TaskId (In Progress)**
  - **Goal**: Enforce PR task_id lock, LATEST.json consistency, and local/CI parity.
  - **Status**: PR Created.

### Milestone M5: 机会算法+LLM (Algo & DeepSeek)
**目标**: 机会路由、结构化输出、成本控制、DeepSeek 调用。
- **PR 1: M5: LLM router & structured output**
  - **目标**: 实现机会路由到 LLM (DeepSeek) 并获取结构化 JSON。
  - **DoD**: 成功将 Opportunity 转换为标准 JSON 格式 (DeepSeek V3/R1)。
  - **证据要求**: `rules/task-reports/2026-02/M5_PR1_llm_json_260211_005.txt` (DOD_EVIDENCE_M5_PR1_LLM_JSON).
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
### Costing Assumptions (Tech Cost)
- **Principle**: "Tech Cost" refers to the **cost estimation model**, not the implementation details.
- **Standard**:
  - Use standard unit costs (e.g., per-token, per-hour, per-request).
  - Apply these assumptions to OppRadar's specific architecture.
  - **Do NOT** conflate cost models with schema design.

### Data Capture First (Training Readiness)
- **Principle**: **Capture EVERYTHING from Day 1**. Even if we use free/cheap models initially, we must build the dataset for future training.
- **Requirement**:
  - **Store**: Market Snapshots, News/Event Snapshots, Probability Changes, Trigger Logs, Re-eval Logs, LLM Inputs/Outputs, Final Labels (Settlement Results).
  - **Purpose**: Enable future fine-tuning of local models (e.g., DeepSeek distilled) using high-quality, real-world data accumulated during the "Bootstrap" and "Cloud API" phases.

### LLM Provider Strategy
- **Phase 1 (Bootstrap)**: Use Mock / Free / Low-Cost Cloud APIs to validate the "Loop" (Monitor-Trigger-Reeval). Focus on **Data Capture** pipelines.
- **Phase 2 (Integration)**: Integrate capable models (e.g., DeepSeek V3/R1) via API.
- **Phase 3 (Optimization)**: Transition to local/distilled models if cost/latency dictates, using the **Captured Data** from Phase 1 & 2.

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
- **Command Templates**: All tasks MUST use the standard command templates defined in `rules/rules/WORKFLOW.md` (ENV=PowerShell|bash). `cd /d` is strictly prohibited.
- **Evidence**: All PRs must include standard evidence artifacts (Healthcheck, Envelope, Postflight).

## Progress Log / Changelog (进度日志)
| Task ID | Summary | Status | Key Evidence | Impact |
| :--- | :--- | :--- | :--- | :--- |
| **260212_001** | News Pull Endpoint (MinSpec/Tests) + 脚本降级搬迁 | **PASS** (EXIT=0) | `rules/task-reports/2026-02/notify_260212_001.txt` | 确立了“辅助脚本不进 scripts 目录”的最小化原则 |
| **260211_007** | Two-Pass Evidence Truth + No Auto-Merge | **PASS** (EXIT=0) | `rules/task-reports/2026-02/notify_260211_007.txt` | 强制执行“双通道验证”与“禁止自动合并”规则 |
| **260211_006** | Historical Evidence Retrofit + Deletion Audit + CI Parity | **PASS** (EXIT=0) | `rules/task-reports/2026-02/notify_260211_006.txt` | 确立了历史证据补齐的收敛方式与防篡改机制 |

<!-- smoke -->
