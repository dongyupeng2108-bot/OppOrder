# TraeTask_260328_020 Truth Audit（梯队价位 YES/NO 双侧现象）

## 结论

- 唯一结论：**A（策略预期行为，UI 文案误导）**
- 断言：当前现象是双边梯队策略按设计在每个 price 同时挂 YES/NO；未发现同价同方向重复挂单。

## 关键事实

1. 策略配置事实：
   - `ladder_prices=[0.27,0.24,0.21,0.18]`
   - `ladder_size=5`
   - `decision.intents=PLACE_LADDER(side=BOTH, prices=[...], size=5)`

2. 订单事实（price × side）：
   - 0.27: YES×1, NO×1
   - 0.24: YES×1, NO×1
   - 0.21: YES×1, NO×1
   - 0.18: YES×1, NO×1
   - 汇总：`open_total=8, open_yes=4, open_no=4`

3. 重复挂单核查：
   - `DUP_SAME_SIDE_COUNT=0`（同价同方向重复数为 0）
   - 因此不存在执行层“同侧重复挂单”证据。

4. 生产/消费链：
   - 生产：`decideBotAction` 产出 `PLACE_LADDER(BOTH, prices, size)`；
   - 执行：`mapIntentToPaperAction -> PLACE_BOTH_LADDERS`；
   - 落账：`placeBothLadders` 对每个 price 生成 `YES` + `NO` 两单；
   - 消费：`GET /bot/orders` 返回 `orders + summary(open_yes/open_no/open_total)`，前端 `se_renderOrders` 渲染。

## 下一步最小修复建议（仅 1 条）

- 仅改 UI 参数区文案口径：将“单档数量”明确为“**每边单档数量**”，并在“挂单价格梯队”旁补充“**总挂单数=梯队档位数×2（YES+NO）**”。
