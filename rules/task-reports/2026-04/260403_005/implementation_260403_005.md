## TraeTask_260403_005 实施记录（heavy gate：统一短超时 + fail-fast）

### 范围与固定口径
- 仅优化 heavy 执行效率；不改 light；不改 heavy 覆盖/强制项。
- 固定硬超时：scanner/universe/trading 统一 4000ms。
- fail-fast：首个硬失败立即退出，输出 `FIRST_FAILED_STAGE`、`FAIL_FAST_ABORTED`、`SKIPPED_AFTER_FAIL`。

### 脚本改动
- `scripts/gate_light_ci.mjs`
  - 增加 `HEAVY_ENDPOINT_HARD_TIMEOUT_MS=4000`，封装 `fetchWithTimeout`，用于 scanner/universe/trading
  - fail-fast：记录首个失败阶段并输出三行关键信息；停止后续非依赖检查
  - 注入钩子：`GATE_FAILFAST_INJECT_STAGE`（仅治理验证使用，默认关闭）
  - 保留 260403_004：并行与 mock server 单会话复用
- 新增治理验收脚本：`scripts/truth_audit_heavy_timeout_failfast_260403_005.mjs`

### 文档改动
- WORKFLOW / PROJECT_RULES / PROJECT_MASTER_PLAN：补充 260403_005 提效边界、统一短超时与 fail-fast 说明

### 运行
- `node --check` 通过
- 三组验证由 `truth_audit_heavy_timeout_failfast_260403_005.mjs` 覆盖
