# TraeTask_260328_026 Truth Audit（竞态 / 优先级）

## 结论

- 唯一结论：**C（存在业务语义断裂）**
- 唯一 first_break_layer：**策略决策层（方向撤单防抖判定）**
  - 证据：同窗口内 `up_cancel_formula` 出现两次（i=4, i=5），发生重复触发。

## 五项不变量审计事实

1. 撤单优先于挂单（同 tick）：
   - 样本A：
     - i=2: `reason=ladder_not_posted`, `open_yes=2,open_no=2,total=4`
     - i=4: `reason=up_cancel_formula`, `open_yes=0,open_no=2,total=4,cancelled_total=2`
   - 事实：撤单触发 tick 未新增订单（`total` 未增加），且同方向未再挂单。

2. 非 PLACE_LADDER tick 不得新增订单：
   - 样本A：`A_NON_PLACE_ADD_EVENTS=`（空）
   - 样本D（down_cancel 场景）：
     - i=4 之后 `reason=down_cancel_formula/price_or_bounds_null`，`total` 维持 6 不再增长。

3. 方向防抖（同方向不得重复触发）：
   - 样本A：
     - i=4: `reason=up_cancel_formula`
     - i=5: `reason=up_cancel_formula`
     - `A_CANCEL_HITS=2`
   - 判定：同窗口同方向出现重复公式触发，防抖不满足。

4. 同价同方向重复 open order：
   - 样本A：`A_DUP_MAX=0`
   - 样本D：TRACE 中未出现同 side+price 重复 open 聚集。
   - 判定：本轮未发现重复 open order。

5. UP / DOWN 双边隔离：
   - UP 触发场景（样本A）：
     - 触发后：`open_yes=0, open_no=2`，仅撤 UP。
   - DOWN 触发场景（样本D）：
     - 触发前：`D_BEFORE={"open_yes":2,"open_no":2,...}`
     - 触发后：`D_AFTER={"reason":"down_cancel_formula","open_yes":2,"open_no":0,...}`
   - 判定：两边动作互不串扰成立。

## 诊断补充

- `GET / => 200`
- `GET /pairs => ERR`
