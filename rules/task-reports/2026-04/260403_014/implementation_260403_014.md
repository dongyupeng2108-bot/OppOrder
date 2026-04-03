## TraeTask_260403_014 实施记录（heavy 默认边界静态 domain 化）

### 范围与约束
- 仅修改 `scripts/gate_light_ci.mjs`、`scripts/finalize_task_evidence.mjs`、静态 domain 配置与规则文档。
- 不引入按 diff/path 自动触发，不改 light/heavy 分层定义，不改 heavy mandatory 语义，不触碰业务链/UI/contracts。

### 核心实现
- 新增静态 domain 配置：`.trae/gate_domain_map.json`
  - heavy 默认域：`btcqdd`
  - 显式可选：`btcqdd | opportunities | global | full`
- `gate_light_ci.mjs` 增加 `--domain`：
  - `--profile heavy` 缺省等价 `--domain btcqdd`
  - 输出 `TASK_DOMAIN` 与 `DOMAIN_PACKS`
- 默认 `btcqdd` heavy 移出跨域 pack：
  - `news/rank/export/ledger/scanner/universe/trading`
  - `Rank V2 Contract Version Guard`
  - 改为显式 `--domain opportunities|full` 才执行
- 新增可解释跳过日志：
  - `DOMAIN_SKIP: opportunities contract pack skipped (domain=...)`
  - `DOMAIN_SKIP_CHECKS: news/rank/export/ledger/scanner/universe/trading`
- `finalize_task_evidence.mjs` 仅透传 `--domain` 给 preview gate 与最终 gate（不改产物策略）。

### 验收脚本
- 新增 `scripts/truth_audit_heavy_domain_static_260403_014.mjs`
  - 覆盖 BTCQDD 默认 heavy、显式 full、显式 opportunities、light 烟雾、跳过可解释。

### 执行结果
- `node --check scripts/gate_light_ci.mjs`：通过
- `node --check scripts/finalize_task_evidence.mjs`：通过
- `node --check scripts/truth_audit_heavy_domain_static_260403_014.mjs`：通过
- 主验收：通过（`first_break_layer=NONE_CHAIN_PASS`）
