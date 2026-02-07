# Opportunity Radar (机会雷达) Master Plan

## M0: Bootstrap (Current)
- DoD: Docs, Gates, Envelope mechanism running.

## M1: Core Data & Strategy
- DoD: Data ingestion, Strategy definition, Backtest engine.

## M2: Live Trading & Validation (DONE)
- **Goal**: Establish minimal loop for Diff (Compare) and Replay (Validation).
- **Status**: DONE (Tasks 260206_008 & 260206_009).
- **Capabilities**:
  - Diff API/UI: Compare two scans to find added/removed/changed opportunities.
  - Replay API/UI: Reconstruct full opportunity context from a historical scan.
  - Fail-fast & Evidence integration.

## M3: Export & Analytics (Next)
- **Goal**: Enhanced data export for external analysis.
- **DoD**:
  1. Export Enhanced JSON (including derived metrics).
  2. Export CSV (tabular format for spreadsheet analysis).
  3. Maintain strict Gate Light & Evidence continuity (no regression).


## M4: 扫描工程化 (Scanning Engineering)
- **Goal**: 增量/缓存/并发/限流/错误隔离/可观测。
- **KPI页**: 作为“可观测”子项挂起，标注“暂缓实现”。

## M5: 机会算法+LLM (Opportunity Algorithm & LLM)
- **Goal**: 路由、结构化输出、降级、成本闸门、回归集、漂移门槛。

## Roadmap (路线图)
把剩余工作拆成 里程碑 → PR（最小可验收单元），后续开发按此推进。

### Milestone M4: 扫描工程化
- **PR 1: M4: scan cache (v0)**
  - **目标**: 实现基础扫描缓存，避免重复计算。
  - **DoD**: 相同参数的连续两次扫描，第二次耗时减少 > 80%。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR1_cache_smoke.txt` (记录两次扫描耗时对比)。
  - **风险**: 缓存失效逻辑错误导致陈旧数据。
- **PR 2: M4: concurrent scan engine**
  - **目标**: 支持多品种/多时间周期并发扫描。
  - **DoD**: 支持至少 3 个并发任务不阻塞。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR2_concurrent_log.txt`。
  - **风险**: 内存溢出，线程锁竞争。
- **PR 3: M4: scan observability & health**
  - **目标**: 增加扫描过程的可观测性（日志、进度、错误隔离）。
  - **DoD**: 单个品种扫描失败不影响全局，且有明确错误报告。
  - **证据要求**: `rules/task-reports/2026-02/M4_PR3_error_isolation.txt`。
  - **风险**: 日志量过大。

### Milestone M5: 机会算法+LLM
- **PR 1: M5: LLM router & structured output**
  - **目标**: 实现机会路由到不同 LLM 模型并获取结构化 JSON。
  - **DoD**: 成功将 Opportunity 转换为标准 JSON 格式。
  - **证据要求**: `rules/task-reports/2026-02/M5_PR1_llm_json.txt`。
  - **风险**: LLM 幻觉，格式解析失败。
- **PR 2: M5: cost gate & fallback**
  - **目标**: 增加成本控制闸门与降级逻辑。
  - **DoD**: 达到预设成本阈值后自动切换到低成本模型或停止。
  - **证据要求**: `rules/task-reports/2026-02/M5_PR2_cost_gate.txt`。
  - **风险**: 成本计算不准。

<!-- smoke -->