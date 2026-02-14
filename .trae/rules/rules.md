# OppRadar Project Rules Index (Read-on-demand) 
 
 Authoritative docs live in: rules/rules/ 
 - WORKFLOW.md 
 - PROJECT_RULES.md 
 - PROJECT_MASTER_PLAN.md 
 
 HARD INTERLOCK (must comply before any action): 
 1) Message Header Protocol & MODE BEHAVIOR: 
    Every user message MUST start with exactly one of: 
    - TraeTask_ / FIX: -> EXECUTION ALLOWED (Plan -> Act -> Verify). 
    - 讨论: -> READ-ONLY. STRICTLY FORBIDDEN: File edits, Shell commands, Git ops. 
      (If user asks for changes in Discussion, reply with PLAN only and request explicit FIX: header). 
    If missing: STOP. No guessing. No commands. Output only the standard violation message. 
 
 2) PR-Only / No Auto-Merge: 
    Never run git merge / push main. Only produce "Merge-Ready" notice + evidence. 
    
 3) Two-Pass Evidence Truth (Gate Light evidence): 
    Pass1 generate log -> extract preview -> build snippet -> Pass2 verify (GATE_LIGHT_EXIT=0). 
    Never hand-edit preview/snippet. 
 
 4) Atomic Evidence Container: 
    If notify/result/report/envelope changes, you MUST regenerate deliverables_index in same round. 
 
 5) New Gate checks require Negative Tests: 
    Any new/strengthened Gate Light guard must include 1-2 negative test artifacts (with [BLOCK] + exit code) and be indexed. 
 
 6) Retrofit / Evidence-only update: 
    Use Dual Commit Lineage (Base vs Landing) with Code Drift = 0. 
    Scope must stay inside rules/task-reports/** (including envelopes/index). No scope pollution. 
 
 7) CI Parity semantics: 
    Base=origin/main, Head=current commit, MergeBase=calculated. Never Base=Head=MergeBase(scope=0). 
 
 RULE: 
 When starting a TraeTask_ or FIX:, first open and read the relevant section(s) in WORKFLOW.md / PROJECT_RULES.md before executing.
