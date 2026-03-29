# TraeTask_260328_035 Truth Audit（观测与证据一致性）

## 结论

- 唯一结论：`A：观测与证据一致`
- first_break_layer：`null`

## 关键检查

- `035-A_reason_action_continuous_ticks = true`
- `035-B_place_cancel_noop_triad_consistency = true`
- `035-C_summary_orders_reconcile = true`
- `035-D_evidence_structure_complete = true`

## 最小事实摘录

- real runtime 连续样本：
  - `runtime_unique_ticks=6`
  - `runtime_reason_preview_mismatch=0`
  - `runtime_reason_action_mismatch=0`
  - 三类 tick 均出现：`has_place_tick=true`、`has_cancel_tick=true`、`has_noop_tick=true`

- reason 与动作对照：
  - `last_reason=ladder_not_posted` 对应 `intents_kinds=["PLACE_LADDER","PLACE_LADDER"]`
  - `last_reason=within_bounds_or_no_trigger` 对应 `intents_kinds=["NOOP"]` 且 `action_by_delta=NO_CHANGE`
  - `last_reason=btc_price>=upper_bound` 对应 `intents_kinds=["CANCEL_OPEN"]` 且 `action_by_delta=CANCEL_OR_CLOSE`

- 三类对照（runner tick）：
  - `noop_reason=within_bounds_or_no_trigger`
  - `place_reason=ladder_not_posted`
  - `cancel_reason=btc_price>=upper_bound`

- summary 与 orders 对账：
  - summary：`total=13/open_yes=3/open_no=0/filled_total=3/cancelled_total=7`
  - 明细聚合：`total=13/open_yes=3/open_no=0/filled_total=3/cancelled_total=7`
  - `reconcile_pass=true`

- 诊断健康：
  - `GET / => 200`
  - `GET /pairs => 404`
