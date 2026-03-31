## What

End-to-end tests that spin up a fresh Everr instance, run the onboarding import against a dedicated test repo, and verify the full pipeline (GitHub API fetch, collector ingestion, PG/CH writes, dashboard queries).

## Why

The import backfill touches every layer of the stack: GitHub API, webhook signing, pg-boss queuing, Go collector, ClickHouse ingestion, Postgres status writes, and dashboard queries. Unit tests mock most of these boundaries. An e2e test using a real (but controlled) test repo would catch integration issues like the x-hub-signature-256 bug that only surfaced at runtime.

## Who

Platform / backend team.

## Rough appetite

medium

## Notes

- Use a stable test repo with a known set of workflow runs (e.g. `citric-app/citric-web-app-test-repo` or a dedicated fixture repo with pinned runs).
- The test would: create a tenant, run the backfill for the test repo, then assert expected row counts in PG and CH.
- Could run in CI with docker-compose (postgres + clickhouse + collector) — similar to the existing dev setup.
- Needs a GitHub App installation token for the test repo — could use a dedicated test installation or mock the GitHub API with recorded responses.
