# TraeTask_260330_041 实施记录（原始日志收口）

## 范围执行

- 本轮仅做日志收口，不改业务决策/执行语义。
- 修改文件：
  - `strategies/crypto_binary/bot_logger.mjs`
  - `scripts/truth_audit_log_noise_reduction_260330_041.mjs`
- 未修改：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
  - 下单/撤单、窗口生命周期、PNL、账户链、版本测试总入口

## 噪声类型清单（本轮判定）

- 高频心跳类低价值事件：
  - `RUNNER_TICK`
  - `BOT_TICK_OK`
- 同事实高频门控事件：
  - `BOT_DECISION_GATED`
- 特征：短时间内连续重复，新增信息密度低，影响人工读日志效率。

## 收口方案

- 在 `bot_logger` 增加事件级节流（throttle）：
  - `RUNNER_TICK`：3000ms
  - `BOT_TICK_OK`：3000ms
  - `BOT_DECISION_GATED`：1500ms
- 保留高价值事件不做节流：
  - `BOT_INTENTS` / `BOT_FILL` / `BOT_WINDOW_CHANGED`
  - 以及 `PLACE_LADDER` / `CANCEL_OPEN` 相关事实日志

## 验证执行

- 修前基线（同场景）：
  - `node scripts/truth_audit_log_noise_reduction_260330_041.mjs --task_id=260330_041 --sample=log_noise_reduction_v1 --mode=baseline --output=rules/task-reports/2026-03/260330_041_log_baseline_before.json`
- 修后对比（同场景）：
  - `node scripts/truth_audit_log_noise_reduction_260330_041.mjs --task_id=260330_041 --sample=log_noise_reduction_v1 --mode=after --baseline_file=rules/task-reports/2026-03/260330_041_log_baseline_before.json --output=rules/task-reports/2026-03/260330_041_truth_audit_log_noise_reduction.json`
- 结果：
  - `pass=true`
  - `total_delta=-14`
  - `noise_delta=-8`
  - `PLACE_LADDER` 计数不变（24 -> 24）
