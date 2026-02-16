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

## Roadmap (路线图) - Dual Track (M Business / P Governance)

### Phase 1: Foundation & Standardization (Current)
**Goal**: 跑通全链路，实现数据/策略/验证的标准化与可信度。
**Status**: In Progress.

#### P-Series (Process & Governance)
*   **P0: Governance Baseline (Replaces M_Hardening)**
    *   **Goal**: 建立双轨制规划，固化工作流协议，消除验证漂移。
    *   **Deliverables**: Dual-track Plan, Contract Version Guard, CI Parity Evidence.
    *   **Mapping**: Covers scope of former `M_Hardening`.
*   **P1: Workspace Healer (DONE)**
    *   **Deliverables**: `reset_workspace.ps1`, Preflight Cleanliness Check.
*   **P2: Evidence Engine v1 (DONE)**
    *   **Deliverables**: Archive Completeness, Pre-lock Validation, Git Ignore Fixes.
*   **P3: Tooling Decouple (DONE)**
    *   **Deliverables**: `run_task.ps1` State Machine (Dev/Integrate), Immutable Integrate Guard, Unified Server Policy.
*   **P4: Documentation Convergence (In Progress)**
    *   **Goal**: 收口 P1-P3 的“硬规则”，形成可执行的 WORKFLOW/RULES。
    *   **Deliverables**: Updated WORKFLOW.md, PROJECT_RULES.md, PROJECT_MASTER_PLAN.md.

#### M-Series (Business & Product)
*   **M0: Bootstrap (DONE)**
    *   **Deliverables**: Infrastructure, Gate Light, Evidence Envelope.
*   **M1: Core Data & Strategy (DONE)**
    *   **Deliverables**: Data ingestion, Strategy definition, Backtest engine.
*   **M2: Live Trading & Validation (DONE)**
    *   **Deliverables**: Diff API/UI, Replay API/UI, Fail-fast evidence.
*   **M3: Export & Analytics (DONE)**
    *   **Deliverables**: Enhanced JSON export, CSV export.
*   **M4: Scanning Engineering & Data Enrichment (In Progress)**
    *   **Goal**: 提升扫描能力、效率与数据丰富度。
    *   **PR 0-5**: See detailed breakdown below.

### Phase 2: Scale & Automation (Next)
**Goal**: 提升扫描规模，引入自动化流水线与高级治理。

### Phase 3: Intelligence & Ecosystem (Future)
**Goal**: 本地模型训练，生态扩展。

### Milestone Mapping (Old -> New)
| Old Milestone | New Milestone | Scope |
| :--- | :--- | :--- |
| M_Hardening | P0 | Governance, Workflow, CI Parity |

### Opportunity Validity Mechanism (Placeholder)
*   **Target Phase**: Phase 1
*   **Goal**: Ensure opportunities are valid and tradeable.
*   **DoD**: (Pending Definition)

### Milestone M4 Details (Preserved)
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
- **Task 260214_005: Gate Light Evidence Truth (DONE)**
  - **Goal**: Ensure snippet exit code matches real log exit code.

## Process Learnings (006/007 Retrospective)
**Core Lessons for v3.9 Governance**:
1.  **CI Parity Instability**: The main blocker is Anchor Drift (Base/Head/MergeBase) during the "Generate <-> Commit <-> Verify" cycle. **Fix**: Use stable anchors (Base) and allow Evidence-Only Updates (trace to Base, drift=0).
2.  **Self-Referential Binding**: Including evidence in the commit changes the Head Hash. **Fix**: Explicitly define the binding rule (Evidence binds to Logic Source, not necessarily Evidence Commit).
3.  **Environment Hard Rules**:
    *   **LF Only**: All text evidence MUST be LF-normalized before hashing.
    *   **No UTF-16**: Ban PowerShell default redirection; use `curl --output` or Node `fs`.
4.  **Verifiable != Absolute Trust**: Gate Light provides **Traceability** and **Tamper-Evidence**, not mathematical proof. Do not over-promise "100% Trust".

## 回归业务开发条件 (Return to Business Logic Criteria)
- [ ] **Governance Debt Cleared**: P-Series tasks (P0-P4) fully DONE and merged.
- [ ] **Workflow Stability**: 连续 3 次业务 PR 无需“Fix”即可一次性通过 Gate Light。
- [ ] **Documentation Sync**: WORKFLOW.md 和 PROJECT_RULES.md 包含所有已知硬规则。

## 本窗口任务台账 (Current Session Task Ledger)

> **Status Legend**:
> *   **MERGED**: Verified merged into `origin/main`.
> *   **DONE**: Evidence passed (Gate Light=0) & pushed, but not necessarily merged.
> *   **OPEN**: PR/Branch exists but not verified/passed.
> *   **UNKNOWN**: Evidence missing or unverifiable.

| Task ID | Status | Branch | PR # | Commit | Gate Light | Key Conclusion |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 260216_001 | MERGED | feat/p1-open-pr-guard-260216_001 | #97 | (via GH) | 0 | Open PR Guard Implemented |
| 260216_002 | MERGED | feat/p1-workspace-healer-260216_002 | #98 | (via GH) | 0 | Workspace Healer Enforced |
| 260216_003 | MERGED | feat/p2-evidence-engine-v1-260216_003 | #99 | (via GH) | 0 | Evidence Archive V1 |
| 260216_004 | MERGED | feat/p3-tooling-decouple-260216_004 | #100 | (via GH) | 0 | Tooling Decouple (Dev/Integrate) |
| 260216_005 | In Progress | feat/p4-doc-convergence-260216_005 | - | - | - | Documentation Convergence |

| 260212_001 | MERGED | feat/news-pull-minspec-tests-260212_001 | - | 7b50c1a | 0 | - |
| 260213_002 | MERGED | docs/plan-sync-260213_002 | - | 081a2f3 | 0 | - |
| 260213_003 | MERGED | feat/news-pull-pagination-260213_003-clean | - | 2454fc5 | 0 | - |
| 260213_004 | MERGED | feat/news-pull-provider-260213_004 | - | 0da8bca | 0 | - |
| 260214_005 | MERGED | feat/news-store-list-260214_005 | - | 4925f3e | 0 | - |
| 260214_006 | MERGED | docs/lessons-006-007-settings-index-260214_006 | - | 2841ea3 | 0 | - |
| 260214_007 | MERGED | chore/post005-smoke-260214_007 | - | 7e2ccdd | 0 | - |
| 260214_008 | DONE | docs/plan-update-published-tasks-only-260214_008 | - | b346903 | 0 | - |
| 260214_009 | DONE | feat/opps-score-v2-260214_009 | - | 3f71d52 | 0 | - |
