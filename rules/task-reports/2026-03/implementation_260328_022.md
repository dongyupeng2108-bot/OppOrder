# TraeTask_260328_022 实施记录（最小 V1 输入契约与执行映射）

## 修复前关键事实

- `/bot/config` 白名单仅允许：`open_delay_sec, ladder_prices, ladder_size, atr_multiple, cancel_all_remaining_sec`
- `PLACE_LADDER` 仅允许 `side=BOTH`，`side!=BOTH` 抛错 `unsupported PLACE_LADDER side`

## 修复后关键事实

- `/bot/config` 现可承载并返回：
  - `up_ladder[]`
  - `down_ladder[]`
  - `up_cancel { before_end_sec, formula }`
  - `down_cancel { before_end_sec, formula }`
- 决策可产生单边梯队意图：
  - `PLACE_LADDER(side=YES, ladder=up_ladder)`
  - `PLACE_LADDER(side=NO, ladder=down_ladder)`
- 执行映射新增：
  - `PLACE_YES_LADDER`
  - `PLACE_NO_LADDER`
- 方向撤单可在服务端 runner tick 判定链触发（公式不走前端）：
  - 示例：`up_cancel_formula`

## 实际样本（real runtime）

- 样本A（独立梯队挂单）：
  - `open_yes=2, open_no=2`
  - OPEN 订单同时含 YES 与 NO，且按各自 ladder 的 price/size 生成
- 样本B（方向性撤单）：
  - 触发前：`open_yes=2, open_no=2`
  - 触发后：`open_yes=0, open_no=2, cancelled_total=2`
  - `last_reason=up_cancel_formula`，未误撤 DOWN
