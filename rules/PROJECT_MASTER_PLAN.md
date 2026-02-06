# Opportunity Radar (机会雷达) Master Plan

## M0: Bootstrap (Current)
- DoD: Docs, Gates, Envelope mechanism running.

## M1: Core Data & Strategy
- DoD: Data ingestion, Strategy definition, Backtest engine.

## M2: Live Trading & Validation (DONE)
- **Goal**: Establish minimal loop for Diff (Compare) and Replay (Validation).
- **Status**: DONE (Tasks 260206_008 & 260206_009).
- **Capabilities**:
  - Diff API/UI: Compare two scans to find added/removed/changed opportunities.
  - Replay API/UI: Reconstruct full opportunity context from a historical scan.
  - Fail-fast & Evidence integration.

## M3: Export & Analytics (Next)
- **Goal**: Enhanced data export for external analysis.
- **DoD**:
  1. Export Enhanced JSON (including derived metrics).
  2. Export CSV (tabular format for spreadsheet analysis).
  3. Maintain strict Gate Light & Evidence continuity (no regression).


<!-- smoke -->