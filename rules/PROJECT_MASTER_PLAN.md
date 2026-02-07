# Opportunity Radar (机会雷达) Master Plan

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

## Execution & Acceptance Conventions
- **Command Templates**: All tasks MUST use the standard command templates defined in `rules/WORKFLOW.md` (ENV=PowerShell|bash). `cd /d` is strictly prohibited.
- **Evidence**: All PRs must include standard evidence artifacts (Healthcheck, Envelope, Postflight).

<!-- smoke -->
