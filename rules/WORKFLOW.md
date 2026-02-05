task_id: M0_OppRadar_Bootstrap_260206_001
milestone: M0
RUN:
  - CMD: node scripts/postflight_validate_envelope.mjs
sentinel: DONE

# Evidence Envelope
- notify: RESULT_JSON + LOG_HEAD + LOG_TAIL + INDEX
- index: size > 0, sha256_short (8 chars)

# Healthcheck
- Port: 53122
- Notify excerpt: "/ -> 200", "/pairs -> 200"
