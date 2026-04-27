# sqlhttp

`sqlhttp` is a read-only HTTP gateway in front of the local shared chdb session. It serves `POST /sql` with a buffered `JSONEachRow` (`application/x-ndjson`) response, enforces a first-token allowlist plus single-statement semicolon guard, caps request bodies at 64 KiB and results at 16 MiB by default, returns `503 Retry-After: 1` until the readiness probe against `otel_logs` succeeds, and maps queue saturation or deadline-style backpressure to retryable `503` responses.
