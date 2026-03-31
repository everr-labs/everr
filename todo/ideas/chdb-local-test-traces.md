# Local Test Traces with chdb

## What
Use [chdb-io](https://github.com/chdb-io/chdb) to store test traces locally for investigation and debugging.

## Why
Having a local ClickHouse-compatible engine for traces would allow quick, offline investigation without needing a running ClickHouse instance or cloud access.

## Who
Internal developer tooling.

## Rough appetite
unknown

## Notes
- chdb is an in-process ClickHouse engine — no server needed.
- Could reuse existing ClickHouse queries directly against local trace data.
