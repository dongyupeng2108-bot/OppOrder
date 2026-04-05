# truth_audit_260405_002

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 结论: 跨窗口成交候选已被阻断；同窗口成交链保持可用

## Fail -> Pass 事实块
- 修前事实（历史坏样本）：
  - `BOT_FILL` 在 `2026-04-05T08:50:05.752Z` 先出现，且订单 `paper_08c0d9e9` 来源窗口为 `btc-updown-5m-1775334300`
  - 同窗口后续 `PLACE_LADDER` 出现在 `2026-04-05T08:50:11.995Z`
- 修后事实（real runtime 受控样本）：
  - 注入 1 笔旧窗口 `OPEN` 订单 + 1 笔当前窗口 `OPEN` 订单
  - 单拍触发后：
    - 旧窗口订单未进入 fills
    - 当前窗口订单成功 FILLED
    - `blocked_cross_window_candidates` 命中旧窗口订单

## 不回退事实块
- stop 后统计链语义未被修改（本任务未触碰 stop 生命周期逻辑）
- today/7d/30 的 `running_window_excluded` 仍返回布尔值且样本中为 true

## 证据索引
- 主证据 JSON：
  - `rules/task-reports/2026-04/260405_002_truth_audit_cross_window_fill_fix_260405_002.json`
- 脚本运行日志：
  - `rules/task-reports/2026-04/260405_002_truth_audit_cross_window_fill_fix_260405_002.log`
