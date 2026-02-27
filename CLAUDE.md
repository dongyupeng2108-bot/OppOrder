# CLAUDE.md — Opportunity Radar (机会雷达)

## Project Overview

**Project**: Opportunity Radar (机会雷达) — data-driven strategy radar for opportunity discovery.
**Repo**: OppOrder | **Local dir**: `E:\OppRadar` | **Port**: 53122 (fixed)

## Environment & Role

- **OS**: Windows — use PowerShell syntax for all commands
- **Project root**: `E:\OppRadar`
- **Role**: Claude Code is Dev — execute tasks as scoped, do not exceed task boundaries. Owner approves and merges PRs.

## Tech Stack

- **Runtime**: Node.js 18+, ES Modules (`.mjs` files)
- **Frontend**: Vanilla JS/HTML/CSS — `OppRadar/app.js` (client-side router)
- **Backend**: `OppRadar/mock_server_53122.mjs` (HTTP, port 53122)
- **Database**: SQLite3 at `data/runtime/oppradar.sqlite` (auto-creates; mock fallback in CI)
- **Dependencies**: `node-fetch`, `sqlite3` only — no build system, no TypeScript
- **Tests**: `npm test` → `node tests/behavior/run_tests.mjs` (custom runner, not Jest/Mocha)

## Directory Structure

```
E:\OppRadar/
├── OppRadar/
│   ├── app.js                   # Frontend UI
│   ├── db.mjs                   # SQLite layer (mock fallback)
│   ├── mock_server_53122.mjs    # HTTP server
│   ├── llm_provider.mjs         # LLM abstraction
│   ├── news_provider.mjs        # News fetching
│   ├── strategy_registry.mjs    # Plugin registry
│   ├── scan_filter.mjs          # Hard filter
│   ├── run_output.mjs           # Run output (opportunities.json + report.md)
│   ├── validate_schema.mjs      # JSON schema validation
│   ├── rank_v2_provider.mjs     # Scoring provider
│   ├── ledger/opps_ledger_v0.mjs  # Append-only JSONL ledger
│   ├── strategies/              # Strategy plugins
│   └── contracts/               # JSON schemas
├── tests/behavior/              # Behavior tests
├── scripts/                     # 80+ CI/ops scripts
├── rules/rules/                 # Governance docs
├── data/                        # Runtime data (SQLite, ledger, run outputs)
└── ui/                          # Static frontend assets
```

## Core Architecture

**Data flow**: Strategy → Snapshot → Scan → Opportunities → Ledger + DB + Run Output

**Key patterns**:
- **Plugin Registry**: Strategies implement `{ id, version, run(snapshot, candidates, ctx) }` and self-register. No pipeline changes needed.
- **Append-Only**: Ledger (`data/opps_ledger/opps_ledger.jsonl`) and most DB ops are append-only. Never destructively update.
- **Provider Pattern**: LLM, news, rank all use abstract interfaces with deterministic mock implementations.
- **Contract-Driven**: All entities validated against JSON schemas in `contracts/`. Use `validate_schema.mjs`.
- **Determinism First**: Mock mode MUST produce identical output for identical inputs (content-based hashing). Tests verify this.

**ID formats**:
- Strategy: `st_[a-z0-9]{8}`, Snapshot: `sn_[a-z0-9]{8}`, Tag: `tg_[a-z0-9]{8}`, Opportunity: `op_[a-z0-9]{8}`, Scan: `sc_[a-z0-9]{8}`
- Opportunity IDs in ledger: SHA256 hex substring (16 chars)

## Data Model

| Entity | Key Fields |
|--------|-----------|
| Strategy | `strategy_id`, `name`, `version`, `status` (DRAFT→ACTIVE→DEPRECATED) |
| Snapshot | `snapshot_id`, `strategy_id`, `timestamp` (ISO8601), `data` |
| Opportunity | `opp_id`, `strategy_id`, `snapshot_id`, `score` (0..1), `tradeable_state` (YES/NO/UNKNOWN) |
| Scan | `scan_id`, `timestamp`, `opp_ids[]`, `duration_ms` |

**OpportunityCard** (central contract): required fields `id`, `title`, `score`, `run_id`, `created_at`.

## Key APIs (port 53122)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/scans/run` | Execute scan, returns `scan_id`, `opp_ids[]` |
| GET | `/opportunities/runs` | List runs (limit max 50) |
| GET | `/opportunities/by_run` | Opps for a run (sorted by score desc) |
| GET | `/opportunities/rank_v2` | Scored opps (`p_hat`, `p_llm`, `p_ci`, `score_v2`) |
| POST | `/news/pull` | Pull news for topic |
| POST | `/opportunities/llm_route` | LLM evaluation of opps |
| GET | `/diff` | Diff two scans (`from_scan`, `to_scan`) |
| GET | `/replay` | Replay a scan |

## Banned Commands — STOP IMMEDIATELY if tempted to use these

| Banned | Use instead |
|--------|-------------|
| `>` or `>>` file redirection | `node scripts/ops_write_file.mjs` |
| `git add -f` | `node scripts/ops_git_stage_task_evidence.mjs` |
| `grep` or `Select-String` | `node scripts/ops_scan_text.mjs` |
| Chained commands (`;`, `&&`, `\|\|`) | Single commands only |
| `git merge` to main / protected branches | Owner merges PR — agent stops at PR Created |
| `cd /d` syntax | Use absolute paths directly |

## Protected Files — NEVER MODIFY

Absolute prohibition (requires Owner authorization):
- `scripts/ops_hardstop_latch.mjs`
- `scripts/run_task.ps1`
- `scripts/safe_commit.ps1`
- `scripts/safe_push.ps1`
- `scripts/postflight_validate_envelope.mjs`
- `scripts/gate_light_ci.mjs`
- `PROTECTED.md`

Require PR justification:
- `scripts/assemble_evidence.mjs`
- `rules/rules/WORKFLOW.md`
- `rules/rules/PROJECT_RULES.md`

## Workflow Rules

- Only one open PR allowed at a time — check before starting a new task
- Once Integrate succeeds, the task is locked — new changes require a new Task ID
- Evidence files must be LF + UTF-8 (no BOM) — never use PowerShell `>` which creates UTF-16

## CI / Gate Light System

**Gate Light** = automated CI check that validates the Evidence Envelope.

**Hard Gates** (block merge if failing):
- Scope Lock: changed files must be in whitelist
- CI gate-light-check must PASS
- `rules/LATEST.json` task_id must match current task
- PROTECTED files must not be modified
- Evidence validation (all required fields present, hashes correct)

**Evidence files** (generated per task, never manually edit historical ones):
- `notify_<task_id>.txt` — DoD markers, healthcheck, GATE_LIGHT_EXIT=0
- `result_<task_id>.json` — gate_light_exit, report_file, report_sha256_short
- `deliverables_index*.json` + `envelope.json` — hash bindings (atomic: all must be regenerated together)
- `trae_report_snippet_<task_id>.txt` — COMMIT field must match `git rev-parse --short HEAD`
- `healthcheck_root_53122_<task_id>.txt` / `healthcheck_pairs_53122_<task_id>.txt`

**Critical constraints**:
- All evidence files: LF + UTF-8 (no BOM). Never use PowerShell `>` redirection.
- Evidence is append-only. Never touch historical evidence files (filenames without current task_id).
- `AGENT MUST NOT run `git merge` or `git push` to main/protected branches — only the Owner merges.
- Use `scripts/safe_commit.ps1` and `scripts/safe_push.ps1` — chained shell commands (`;`, `&&`, `||`) are prohibited in command_audit logs.
- Task-specific scripts go in `rules/task-reports/<YYYY-MM>/generate_evidence_<task_id>.js`, NOT in `scripts/`.
- `PROJECT_MASTER_PLAN.md` status is read-only for agents — run `node scripts/sync_plan_status.js` to sync.

**Troubleshooting order** (must follow strictly):
1. First failing Gate Light point: SnippetCommitMustMatch / Postflight / Evidence Truth / Healthcheck / LF-encoding
2. Check result/notify consistency (report_file, sha256_short, gate_light_exit)
3. Check deliverables_index / envelope hash consistency
4. Check healthcheck paths (HTTP 200) and LF consistency

## Error Self-Heal Whitelist

May be auto-fixed: `CI_PARITY_MERGEBASE_MISMATCH`, `ERROR_STATS_INDEX_MISSING`, `LATEST_JSON_MISMATCH`, `PREVIEW_ENCODING`

Never self-heal: `EVIDENCE_WORM_BYPASS`, `OPEN_PR_GUARD_BLOCKED`, `WORKSPACE_DIRTY_TRACKED`, `TASK_ID_MISMATCH`, `LOOP_DETECTED`, `CONTRACT_SELF_CHECK_FAIL`, `PREASSEMBLE_*`, and others in the non-self-healable blacklist.

## Versioning Layers

| Layer | Scope | Stability |
|-------|-------|-----------|
| L1 | External API contracts (rank_v2 schema, OpportunityCard fields) | Most stable — needs version bump to change |
| L2 | Data & Mock layer (deterministic mock contracts, fixtures) | Requires regression |
| L3 | Scoring algorithm (score_v2 weights) | Frequent iteration OK |
| L4 | Governance (WORKFLOW, Gate, Evidence rules) | Most fluid |

## Development Notes

- No TypeScript — duck typing with runtime schema validation
- SQLite mock fallback activates automatically in CI (no sqlite3 binary)
- Run outputs written to `data/runs/{runId}/opportunities.json` + `report.md`
- Frontend is a client-side SPA; all data via `fetch()` to port 53122
- Milestone naming: `M*` = product milestones, `P*` = process/governance milestones
- Task IDs format: `YYMMDD_NNN` with optional 1-letter suffix (e.g., `260227_007`)
