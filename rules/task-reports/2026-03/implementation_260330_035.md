# TraeTask_260330_035 实施记录（当前窗口标签来源修复）

## 范围执行

- 本轮仅修复 `current_window_label_source`，不扩到业务执行链。
- 未修改业务逻辑文件：
  - `strategies/crypto_binary/bot_runner.mjs`
  - `strategies/crypto_binary/bot_strategy.mjs`
- 未修改挂单逻辑、PNL、账户链、版本测试总入口。

## 代码修复

- 文件：`ui/js/strategy-editor.js`
- 修复点：`se-log-current-window` 的取值源由旧链
  - `postmortem?.window_id || lastRun?.current_window_id`
- 调整为当前窗口优先链
  - `status?.current_window_id`
  - `activeRuntime?.current_window_id`
  - `lastRun?.current_window_id`
  - `postmortem?.window_id`
- 说明：仅修显示投影源，未改变服务端语义与交易执行语义。

## 审计与验收脚本

- 新增：`scripts/truth_audit_current_window_label_fix_260330_035.mjs`
- 护栏：
  - `MAX_WALL_TIME=15min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=100`
- 输出：
  - Fail -> Pass 对照（prefix 读取 034 审计结果）
  - real runtime 三时点（启动后 / 首次成交后 / 切窗后）
  - DOM/API/日志三方对账

## 本轮执行结果

- `node --check ui/js/strategy-editor.js`：通过
- `node --check scripts/truth_audit_current_window_label_fix_260330_035.mjs`：通过
- 主审计：
  - `node scripts/truth_audit_current_window_label_fix_260330_035.mjs --task_id=260330_035 --sample=current_window_label_fix_v1 --output=rules/task-reports/2026-03/260330_035_truth_audit_current_window_label_fix.json`
  - 结果：`pass=true`
  - `first_break_layer=NONE_CHAIN_PASS`
  - `fail_to_pass.pass=true`
