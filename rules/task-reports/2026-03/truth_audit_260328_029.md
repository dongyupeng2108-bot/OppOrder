# TraeTask_260328_029 Truth Audit（配置生效语义与保存原子性）

## 结论

- 唯一结论：**A：配置生效语义清楚且一致**
- first_break_layer：**无**

## 029-A~E 审计结果

- 029-A 停止态保存 + 读取一致：PASS
- 029-B 运行态保存但不重启：PASS
- 029-C 运行态保存后 stop/start：PASS
- 029-D 高频连续三次 POST 原子性：PASS
- 029-E saved/preview/runtime 三方对账：PASS

## 最小事实摘录

- 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`
- 029-A：
  - `save_status=200`
  - `/bot/config.current` 与 `decision-preview.config` 均完整保留 `open_delay_sec/up_ladder/down_ladder/up_cancel/down_cancel`（含 `tp_price`）
- 029-B（运行中改配置不重启）：
  - `saved_config = B`
  - `active_runtime_snapshot = A(旧运行配置)`
  - `decision-preview.config = B`
- 029-C（stop/start 后）：
  - `active_runtime_snapshot = B`
  - `saved_config = B`
  - `decision-preview.config = B`
- 029-D（高频连续 POST A->B->C）：
  - `post_statuses=[200,200,200]`
  - `final_config = C`
  - `mixed_detected=false`（未出现 A/B 混合态）
- 029-E（三方对账 + real runtime 连续样本）：
  - `saved_config = C`
  - `decision-preview.config = C`
  - `active_runtime_snapshot = C`
  - `runtime_unique_sample` 至少 4 个连续 tick（含 `last_tick_at` 递进样本）
