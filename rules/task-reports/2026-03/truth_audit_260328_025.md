# TraeTask_260328_025 Truth Audit（策略输入 + 运行执行新契约）

## 结论

- 本轮结论：**本轮 5 链一致（无断裂层）**。
- first_break_layer：**无**（A/B/C/D/E 均未发现断裂）。

## 审计事实

1. 保存/读取链一致：
   - `SAVE1_OK=True`
   - `SAVE1_CURRENT` 含 `open_delay_sec/up_ladder/down_ladder/up_cancel/down_cancel` 且逐档含 `tp_price`。

2. 决策预览链一致：
   - `PREVIEW1_REASON=ladder_not_posted`
   - `PREVIEW1_INTENTS` 同时出现：
     - `PLACE_LADDER(side=YES, ladder=up_ladder...)`
     - `PLACE_LADDER(side=NO, ladder=down_ladder...)`
   - 预览中 ladder 含 `price,size,tp_price`，与保存配置一致。

3. 运行挂单链一致：
   - `RT2_SUMMARY={"open_yes":2,"open_no":2,...}`
   - `RT2_OPEN_ORDERS` 展示 YES/NO 双边独立挂单，`price/size/tp_price/ladder_key` 与配置一致。

4. 止盈绑定链一致：
   - `RT3_FILLED_ENTRY`：`order_id=paper_44de9fad, kind=ENTRY, side=YES, tp_price=0.97, ladder_key=YES:0`
   - `RT3_TP_LINKED`：`kind=TAKE_PROFIT, side=YES, price=0.97, tp_price=0.97, ladder_key=YES:0, parent_order_id=paper_44de9fad`
   - 说明 TP 与成交 ENTRY 在 `tp_price + ladder_key + parent_order_id` 上绑定一致，无混档位。

5. 方向撤单链一致：
   - 触发前：`RT4_BEFORE_SUMMARY={"open_yes":2,"open_no":2,...}`
   - 触发后：`RT4_AFTER_REASON=up_cancel_formula`
   - 触发后汇总：`RT4_AFTER_SUMMARY={"open_yes":0,"open_no":2,"cancelled_total":2,...}`
   - `RT4_AFTER_OPEN` 仅余 NO 侧 OPEN 订单，未误撤 DOWN。

## 诊断补充

- `GET / => 200`
- `GET /pairs => ERR`
