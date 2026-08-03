# Code-side items surfaced by the clickety-clack docs audit

The 2026-08-03 docs-vs-engine audit fixed the docs to describe current
behavior; these are the places where the behavior itself deserves a change.
Each doc was corrected to match the code as it is, so none of these block on
docs work.

## Conflict error codes are inconsistent across resources

Rule and SLO name collisions return code `conflict`
(`src/api/rules.rs:174-177`, `src/api/slos.rs:57-60`) while channels and
receivers return `already_exists` (`src/api/channels.rs:110`,
`src/api/receivers.rs:116`). Same situation, two vocabularies; pick one
(likely `already_exists`) and alias the other during a deprecation window.

## Test endpoints ignore their `:id`

`POST /v1/rules/:id/test` has no path extractor and `POST /v1/slos/:id/test`
explicitly discards the id (`src/api/rules.rs:341-368`,
`src/api/slos.rs:206-213`): no existence or tenant check, any id evaluates
the posted spec. Related wart: the SLO test body is `CreateSloBody`, so a
`name` is required but unused. Either validate the id (404 on miss) or move
the endpoints off the `/:id` shape; drop the unused `name`.

## `GET /v1/slos/:id/status` 404s for a never-evaluated SLO

`create_slo` seeds no `slo_status` snapshot (`src/stores/pg.rs:2567-2604`)
and the handler keys its 404 on the snapshot row
(`src/api/slos.rs:275-281`), so a fresh SLO reports "not found" until its
first evaluation lands. Return an empty/pending status for an SLO that
exists instead.

## `load_smoke.rs` ignore-hint names a nonexistent test target

The `#[ignore]` message says `cargo test --release --test load_smoke`
(`tests/it/load_smoke.rs:4`), but the crate has a single `it` integration
binary gated on `container-tests`; the other load tests' hints are correct.
Fix the string.

## Dev stack has no way to exercise the ClickHouse default-user guard path

`docker-compose.yml` runs only Postgres and Redis, and nothing in the repo
sets `CC_DEV_INSECURE_CH_DEFAULT_USER` (the hardening doc used to claim the
compose stack did; it now says to export it manually). Decide whether the
dev experience should set it (a compose `cc` service or `.cargo/config.toml`
entry alongside `CC_DEV_INSECURE_NO_AUTH`) or stay explicit.
