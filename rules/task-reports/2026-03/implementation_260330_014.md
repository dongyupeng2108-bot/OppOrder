# TraeTask_260330_014 实施记录（P0 修复防回归固化）

## 范围结论

- 本单仅新增/编排验证资产，不改业务逻辑。
- 未修改：
  - `bot_runner.mjs`
  - `bot_context_adapter.mjs`
  - anchor/bounds 业务计算、下单/撤单/tp/UI/PNL/账户链

## 新增可复用入口

- 新增：`scripts/verify_p0_runtime_fixes_guard.mjs`
- 固化两条稳定子结论：
  - `startup_wait_release`
  - `atr_input_bounds_ready`
- 输出格式沿用 verify 标准结构：结论块、关键事实、证据索引。

## 总入口接入

- 已接入 `scripts/verify_all_manual.mjs`：
  - `allchain` 增加 `verify_p0_runtime_fixes_guard.mjs`
  - `module5` 增加 `verify_p0_runtime_fixes_guard.mjs`
  - 新增轻量编排键 `p0guard`（仅执行本回归入口）

## 验证设计

- 当前基线 PASS：
  - 启动门控：真实运行短样本内，启动窗口 `NOOP`，跨新窗口后出现 `PLACE_LADDER(...)`
  - ATR 链：复用 260330_013 验证入口，确认 real runtime 下 `atr_5m -> upper/lower -> bounds_ready`
- 负例 FAIL 识别：
  - 历史 260330_010 事实识别 `wait_next_window_after_start` 持续卡死（检测到 FAIL）
  - 历史 260330_011 事实识别 `atr_5m=null + price_or_bounds_null`（检测到 FAIL）
