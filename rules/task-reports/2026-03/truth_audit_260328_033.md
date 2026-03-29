# TraeTask_260328_033 Truth Audit（公式引擎健壮性与安全边界）

## 结论

- 唯一结论：**C：存在业务语义断裂**
- 唯一 first_break_layer：**C 变量白名单与危险表达式边界层**

## 033-A~F 审计结果

- 033-A 非法公式容错（语法错误/非字符串/空白）：PASS
- 033-B 未定义变量公式：PASS
- 033-C 危险表达式/越界表达式：FAIL
- 033-D UP 失败时 DOWN 仍正常：PASS
- 033-E DOWN 失败时 UP 仍正常：PASS
- 033-F 长公式/嵌套公式下 tick 连续性：PASS

## 最小事实摘录

- 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`

- 033-A（非法公式容错）：
  - 语法错误：`up_cancel.formula="has_open_up_orders && ("`，单 tick 结果 `reason=within_bounds_or_no_trigger`
  - 非字符串：`up_cancel.formula=12345`，配置入库后变为 `""`
  - 空白字符串：`up_cancel.formula="   "`，单 tick 结果 `reason=within_bounds_or_no_trigger`
  - 三类输入下均未触发 `up_cancel_formula`，服务保持可用

- 033-B（未定义变量）：
  - `up_cancel.formula="undefined_symbol > 0"`
  - 单 tick 结果：`reason=within_bounds_or_no_trigger`
  - 诊断：`trigger_up_formula=false`

- 033-C（危险表达式）：
  - `up_cancel.formula="globalThis.process.pid > 0"`
  - 单 tick 结果：`reason=up_cancel_formula`
  - 诊断：`trigger_up_formula=true`
  - 判定：危险表达式未被变量白名单隔离，越权表达式可驱动业务动作

- 033-D（UP 失败不影响 DOWN）：
  - `up_cancel.formula` 语法错误，`down_cancel.formula="has_open_down_orders"`
  - 单 tick 结果：`reason=down_cancel_formula`
  - 诊断：`trigger_down_formula=true` 且 `trigger_up_formula=false`

- 033-E（DOWN 失败不影响 UP）：
  - `down_cancel.formula` 语法错误，`up_cancel.formula="has_open_up_orders"`
  - 单 tick 结果：`reason=up_cancel_formula`
  - 诊断：`trigger_up_formula=true` 且 `trigger_down_formula=false`

- 033-F（长公式性能边界 + real runtime）：
  - 长公式长度：`166`
  - real runtime 连续样本：`runtime_sample` 连续推进，`unique_ticks=19`
  - 采样最大 tick 间隔：`max_gap_ms=1100`（未出现 running=true 且 last_tick_at 长时间不前进）
