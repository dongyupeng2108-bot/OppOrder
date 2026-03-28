# TraeTask_260328_023 实施记录（逐档 tp_price）

## 修复前事实

- `up_ladder[]/down_ladder[]` 行项目仅 `price,size`，无 `tp_price`。
- ledger 的 ENTRY 成交后不会按档位自动生成止盈单。

## 修复后事实

- 输入契约支持并保留：`{ price, size, tp_price }`。
- ENTRY 成交后，按成交订单的 `tp_price + ladder_key + parent_order_id` 生成 `kind=TAKE_PROFIT`。
- 止盈单按方向区分：
  - `side=YES` 用 YES 侧链路；
  - `side=NO` 用 NO 侧链路。

## real runtime 样本

- 配置：`up_ladder=[{price:0.99,size:2,tp_price:0.97}]`
- 成交样本：
  - ENTRY：`order_id=paper_99c555e2, side=YES, price=0.99, tp_price=0.97, ladder_key=YES:0, status=FILLED`
  - TP：`kind=TAKE_PROFIT, side=YES, price=0.97, tp_price=0.97, parent_order_id=paper_99c555e2, ladder_key=YES:0, status=OPEN`
