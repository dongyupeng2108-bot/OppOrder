# TraeTask_260328_034 修复验收（公式白名单与危险表达式边界）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：公式引擎健壮且边界可靠`
- first_break_layer：`null`

## Fail -> Pass 主证据

- Fail（033）：
  - 危险表达式 `globalThis.process.pid > 0` 触发 `up_cancel_formula`
- Pass（034）：
  - 同表达式不再触发公式撤单，`reason=within_bounds_or_no_trigger`
  - `up_formula_eval.ok=false`
  - `up_formula_eval.code=INVALID_CHARACTER`

## 最终白名单变量集合

- `secs_left`
- `spread`
- `volatility_ratio`
- `has_open_up_orders`
- `has_open_down_orders`
- `btc_price`
- `upper_bound`
- `lower_bound`

## 双边隔离与性能

- UP 失败时 DOWN 正常：`reason=down_cancel_formula`
- DOWN 失败时 UP 正常：`reason=up_cancel_formula`
- real runtime 连续样本：`runtime_unique_ticks=18`，`runtime_max_gap_ms=1197`

## 诊断健康

- `GET / => 200`
- `GET /pairs => 404`
