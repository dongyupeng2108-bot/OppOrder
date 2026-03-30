# TraeTask_260330_011 实施记录（anchor/bounds/bounds_ready 时序定位）

## 范围与基线

- 基线：已包含 260330_012 启动门控修复。
- 本单仅新增审计与证据，不改业务语义。
- 未改：
  - anchor_btc / atr / bounds / bounds_ready 业务计算
  - 下单/撤单/tp/UI/PNL/账户链

## 受护执行方式

- 审计脚本：`scripts/truth_audit_anchor_bounds_timing_260330_011.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- real runtime 采用 `/bot/start` 短样本并强制自动停机；无无限循环。

## 样本与对照

- real runtime：
  - 覆盖启动窗口 -> 下一新窗口；
  - 连续采集 `anchor_btc / atr_5m / upper / lower / bounds_ready / decision_reason / decision_intents`。
- debug control：
  - 受控 3 tick（ATR 缺失 -> ATR 到位 -> BTC 漂移）；
  - 用于对照 anchor 冻结与 bounds 计算链路。

## 定位结论

- verdict：`C：存在断裂`
- 唯一 first_break_layer：`atr_input`
- 依据：
  - real runtime 中跨窗后 `anchor_btc` 已冻结，但 `atr_5m` 持续为空；
  - 导致 `upper/lower` 不出现，`bounds_ready` 不能成立，决策停留 `price_or_bounds_null + NOOP`；
  - debug control 在 ATR 到位后可正常生成边界并推进。
