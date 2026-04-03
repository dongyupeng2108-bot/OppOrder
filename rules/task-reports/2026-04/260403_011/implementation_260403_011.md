## TraeTask_260403_011 实施记录（today baseline reset）

### 修复范围
- 新增“清空今日统计数据”按钮（仅 today）。
- 后端以 today baseline/cursor 重置实现清空，不删除历史订单或 postmortem。
- 未修改 PM probe/VPN 链、7d/30 口径、UI 其他区域、verify_all_manual。

### 代码变更
- `ui/js/strategy-editor.js`
  - 在“近期表现摘要”区域新增按钮：`清空今日统计数据`
  - 新增 `se_resetTodayPerformance()`：调用 `POST /bot/performance/today/reset`，完成后强制刷新 today 展示
- `strategies/crypto_binary/server.mjs`
  - 新增 `botTodayResetBaselineTs`（可持久化）
  - today 汇总过滤改为：`completed_at >= effective_today_baseline`
  - 新增接口：`POST /bot/performance/today/reset`
  - recovery snapshot 增加 `today_reset_baseline_ts` 持久化与恢复
  - `/bot/status` 与 `/bot/performance/summary(preset=today)` 增补 baseline 字段回显

### 验证脚本
- 新增：`scripts/truth_audit_today_reset_baseline_260403_011.mjs`
  - Fail->Pass（today 非零 -> reset 后 today 归零）
  - 7d/30 不回退
  - 历史真值未删除证明
  - real runtime 新 completed window 纳入 today
  - running 未提前计入
  - stop 语义护栏事实块
  - server healthcheck（GET /、GET /pairs）

### 执行结果
- `node --check`（server/ui/script）通过
- 主审计通过：`first_break_layer=NONE_CHAIN_PASS`
