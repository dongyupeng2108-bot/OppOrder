# TraeTask_260328_021 Truth Audit（单一双边策略参数 UI V1 语义承载）

## 结论

- 唯一结论：**C（当前执行语义不支持，必须先单独补策略/输入链）**
- first_break_layer：**策略输入契约 + intent→执行动作映射层**
  - 输入契约仅支持全局 `ladder_prices + ladder_size`，不支持 UP/DOWN 独立档位与逐档数量。
  - 执行动作映射仅支持 `PLACE_LADDER(side=BOTH)`，`side!=BOTH` 直接报错。

## 关键事实

1. 当前真实输入字段（`GET /bot/config`）：
   - `open_delay_sec`
   - `ladder_prices`
   - `ladder_size`
   - `atr_multiple`
   - `cancel_all_remaining_sec`

2. 当前执行语义：
   - 支持：方向级整体撤单（`CANCEL_OPEN YES/NO/ALL`）
   - 支持：全局时间条件撤单（`remaining_sec<=cancel_all_remaining_sec`）
   - 不支持：UP/DOWN 各自独立梯队下单（`PLACE_LADDER` 仅允许 `side=BOTH`）
   - 不支持：每档独立数量（仅单个 `ladder_size`）

3. 公式触发链：
   - 当前不存在“手工公式字段”的输入契约与解析链；
   - 决策判定在服务端 runner tick 内执行（不是前端轮询判定）。

## V1 字段映射（只读）

| 目标 UI 字段 | 当前已有字段 | 生产者 | 消费者 | 是否需要扩展 |
|---|---|---|---|---|
| 全局开盘等待秒数 | `open_delay_sec` | `/bot/config`（server） | `decideBotAction` | 否 |
| UP 档位列表（价格+数量） | 部分：仅 `ladder_prices` + `ladder_size`（全局） | `/bot/config` | `decideBotAction -> PLACE_LADDER(BOTH)` | 是 |
| DOWN 档位列表（价格+数量） | 部分：仅 `ladder_prices` + `ladder_size`（全局） | `/bot/config` | `decideBotAction -> PLACE_LADDER(BOTH)` | 是 |
| UP 撤单：结束前若干秒 | 无独立字段（仅全局 `cancel_all_remaining_sec`） | `/bot/config` | `decideBotAction` | 是 |
| DOWN 撤单：结束前若干秒 | 无独立字段（仅全局 `cancel_all_remaining_sec`） | `/bot/config` | `decideBotAction` | 是 |
| UP 撤单：手工公式 | 无 | 无 | 无 | 是 |
| DOWN 撤单：手工公式 | 无 | 无 | 无 | 是 |

## 下一步最小任务建议（仅 1 条）

- 先做“输入契约最小扩展”单任务：新增 `up_ladder[] / down_ladder[] / up_cancel / down_cancel` 字段并打通 `PLACE_LADDER(side=YES/NO)` 映射，再进入 UI 重构任务。
