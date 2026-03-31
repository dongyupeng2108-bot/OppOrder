# TraeTask_260330_019 实施记录（本地验证分层入口）

## 范围结论

- 本单只做测试资产入口收口，不改业务逻辑。
- 未修改下单/撤单/runner/context/strategy 主链。
- 未改 finalize/gate 规则与三大文档模板。

## 分层入口

- 新增脚本：`scripts/run_layered_verify.mjs`
- 支持模式：
  - `--mode=dev-fast`：`node --check + truth_audit_*` 最小主链
  - `--mode=guard`：局部 `verify_*_guard`
  - `--mode=prepr`：`verify_all_manual --module=<x> + finalize_task_evidence + gate_light_ci`
- 参数：
  - `--task_id`
  - `--sample`
  - `--module`
  - `--audit_script`
  - `--guard_script`
  - `--output`

## 兼容口径

- 对 018 类任务可直接传：
  - `--audit_script=scripts/truth_audit_no_terminal_state_fix_260330_018.mjs`
  - `--guard_script=scripts/verify_no_terminal_state_guard.mjs`
  - `--module=p1guard`
- `dev-fast` 明确不包含 `verify_all_manual`。

## 三模式实跑结果

- `dev-fast`：PASS，`356368ms`
- `guard`：PASS，`299680ms`
- `prepr`：PASS，`330169ms`

## 结果摘要

- 已形成可复用分层入口并完成三模式实跑。
- 已证明 `dev-fast` 不触发总入口。
- 已证明 `prepr` 触发 `verify_all_manual + finalize + gate`。
