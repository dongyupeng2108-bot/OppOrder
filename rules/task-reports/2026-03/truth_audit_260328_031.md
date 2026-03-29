# TraeTask_260328_031 Truth Audit（恢复能力与持久化一致性）

## 结论

- 唯一结论：**C：存在业务语义断裂**
- 唯一 first_break_layer：**A 重启恢复语义层**

## 031-A~D 审计结果

- 031-A 运行中断进程后重启，配置/状态恢复：FAIL
- 031-B 部分成交 + TP 已生成后重启：FAIL
- 031-C 连续 stop/start 稳定性：FAIL
- 031-D 重启前后 saved/runtime/orders/status 对账：PASS

## 最小事实摘录

- 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`

- 031-A（重启恢复）：
  - 重启前 `saved_config.open_delay_sec=5`
  - 重启后 `saved_config.open_delay_sec=10`（回到默认）
  - 重启后 `config_current` 同样为默认配置
  - 说明：运行中保存配置未在进程重启后保留

- 031-B（部分成交 + TP 后重启）：
  - 重启前：
    - `ENTRY(FILLED)`：`order_id=paper_97191164, ladder_key=YES:0, tp_price=0.97`
    - `TAKE_PROFIT(OPEN)`：`parent_order_id=paper_97191164, ladder_key=YES:0, tp_price=0.97`
    - `tp_fingerprint=YES|0.97|0.97|YES:0|paper_97191164`，`tp_count=1`
  - 重启后：
    - `tp_count=0`
    - `orders.summary.total=0, filled_total=0`
  - 说明：重启后订单账本呈现清空，出现状态倒退/持久化缺失

- 031-C（连续 stop/start）：
  - `rounds_total=20`
  - `fail_start_no_tick=20`
  - `fail_zombie_after_stop=0`
  - 样本：多轮 `tick_at_stop` 固定 `2026-03-29T08:15:01.236Z`
  - 说明：存在 start 后未形成有效 tick 进展的假活风险

- 031-D（real runtime 连续样本）：
  - `last_tick_at` 连续递进样本：
    - `08:16:26.201Z -> 08:16:27.146Z -> 08:16:28.220Z -> 08:16:29.171Z`
  - `running=true` 且 `last_reason` 持续变化，证明本轮包含 real runtime 连续样本
