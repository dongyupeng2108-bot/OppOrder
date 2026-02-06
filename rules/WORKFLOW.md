task_id: M0_OppRadar_Bootstrap_260206_001
milestone: M0
RUN:
  - CMD: node scripts/postflight_validate_envelope.mjs
sentinel: DONE

# Opportunity Radar (机会雷达) Workflow
*Note: OppRadar is the historical alias/reserved path (E:\OppRadar).*

# Evidence Envelope
- notify: RESULT_JSON + LOG_HEAD + LOG_TAIL + INDEX
- index: size > 0, sha256_short (8 chars)

# Healthcheck
- Port: 53122
- Notify excerpt: "/ -> 200", "/pairs -> 200"

## Gate Light (CI)
- **Definition**: A lightweight required check that runs on every PR/Push.
- **Mechanism**: Reads ules/LATEST.json to identify the most recent task evidence, then executes scripts/postflight_validate_envelope.mjs.
- **Naming**: The GitHub Actions workflow must be named gate-light.
- **Constraint**: Must PASS to merge.
