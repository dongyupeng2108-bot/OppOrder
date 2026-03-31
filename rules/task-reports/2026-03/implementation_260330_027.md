# TraeTask_260330_027 实施记录（流程护栏修复）

## 目标

- 仅修流程护栏：阻止 Dev 阶段过早进入 `finalize_task_evidence` / `gate_light_ci`。
- 未改任何业务逻辑、未改 gate 规则本体。

## 变更

- 修改 `scripts/run_layered_verify.mjs`
  - 在 `mode=prepr` 新增前置检查：
    - 主审计/主验证是否已有 PASS 证据；
    - 工作区业务代码是否脏（`strategies/crypto_binary/*`）；
    - `rules/LATEST.json.task_id` 是否对齐当前 task_id。
  - 任一不满足时直接阻止进入收尾链，不执行 verify_all/finalize/gate。
  - 阻止原因标准化输出：
    - `BLOCK_PREPR_MAIN_VERIFY_NOT_PASS`
    - `BLOCK_PREPR_WORKSPACE_DIRTY`
    - `BLOCK_PREPR_LATEST_OUT_OF_SYNC`
  - 输出 `prepr_guard` 结构（是否放行、命中原因、模式、证据文件等）。

- 新增 `scripts/verify_prepr_guardrails_260330_027.mjs`
  - 负例覆盖：
    - 主验证未通过 -> 阻止
    - 工作区脏 -> 阻止
    - LATEST 未对齐 -> 阻止
  - 正例覆盖：
    - 条件满足 -> 放行（允许进入 finalize/gate）

## 结果

- 护栏脚本验证通过（4/4）。
- finalize 与 gate 在本任务通过。
