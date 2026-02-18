# Error Triage Policy (错误分级策略)

## 1. 概述
本策略定义 OppRadar 项目中任务执行错误的分类、分级与处置标准。
所有 `errors_<task_id>.jsonl` 中记录的错误必须依据本策略进行治理。

## 2. 错误分级 (Priority Levels)

| 级别 | 定义 | 触发条件 | 默认处置 |
| :--- | :--- | :--- | :--- |
| **P0** | **Critical Block** | 导致任务失败 (Exit Code != 0) 或核心功能不可用 | **FIX_NOW** (立即修复) |
| **P1** | **High Impact** | 核心功能降级，或 Gate Light 拦截 (FAIL-fast) | **FIX_NOW** (当场修复) |
| **P2** | **Medium Impact** | 非核心功能异常，或偶发性测试失败 | **BACKLOG** (记录待修) |
| **P3** | **Low Impact** | 日志噪音，非预期警告，不影响产出 | **IGNORE** (忽略或排期) |

## 3. 错误分类与默认级别 (Taxonomy Mapping)

| ERROR_CLASS | 默认级别 | 说明 |
| :--- | :--- | :--- |
| `FAIL_ROOT_CAUSE_BLOCK` | **P0** | 明确的根因阻断 |
| `GATE_LIGHT_FAILURE` | **P1** | 门禁校验失败 |
| `SHELL_EXIT_NONZERO` | **P1** | 脚本执行非零退出 |
| `OPEN_PR_GUARD_BLOCKED` | **P0** | 存在阻塞性 Open PR |
| `RESOURCE_EXHAUSTED` | **P2** | 资源耗尽 (如 API 限流) |
| `TEST_FAILURE` | **P2** | 单元/集成测试失败 |
| `LINT_ERROR` | **P3** | 代码风格问题 (若未阻断 CI) |
| `UNKNOWN_ERROR` | **P1** | 未知错误，需人工排查 |

## 4. 治理规则

### 4.1 3-Strike Rule (三振出局)
任何 P2/P3 错误若在连续 3 个任务中出现，自动升级为 P1，必须在下一个任务中修复。

### 4.2 Gate Light Enforcement (门禁执行)
- CI 门禁必须校验 `errors_summary_<task_id>.txt` 存在。
- 若摘要中包含 P0 级错误且任务声明成功 (Exit 0)，Gate Light 将判定为 **逻辑矛盾** 并拦截。

### 4.3 Backlog Management
P2 错误应记录在 `rules/rules/GOV_BACKLOG.md` 中，并安排后续治理任务。
