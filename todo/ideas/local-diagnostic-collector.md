# Local Diagnostic Collector

## What
A local collector exposed on HTTP that captures events from browser and server (logs, analytics, errors) for offline investigation and debugging — no cloud backend required.

## Why
Having a local collection and storage layer would allow quick, offline diagnostics without needing a running ClickHouse instance or cloud access. Broadens scope beyond test traces to cover any analytics or diagnostic events.

## Who
Internal developer tooling.

## Rough appetite
unknown

## Notes
- chdb is an in-process ClickHouse engine — no server needed.
- Could reuse existing ClickHouse queries directly against local trace data.
- Local collector exposed on HTTP to receive events without a cloud backend.
- Analytics events for diagnostic purposes (not just test traces).
- Capture events from both browser and server: logs, analytics, errors.
- Storage backend: local ClickHouse (via chdb) or DuckDB as alternatives.
