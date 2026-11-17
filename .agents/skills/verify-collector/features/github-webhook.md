# Signed GitHub webhooks

The application receives GitHub App deliveries and replays each one, body and signature unchanged, to the collector's private GitHub listener (`/webhook/github`), adding `x-everr-tenant-id` and `x-everr-retention-{logs,traces,metrics}-days`. The collector checks the `x-hub-signature-256` HMAC, turns a completed `workflow_job` into a job span plus one span per step, and stamps tenant and retention from those headers. `$V webhook` plays the application's part.

## Sub-features

- `gh-job`: a signed completed `workflow_job` returns `202`; `app.traces` gets the job span and its step spans under service `github-actions`, with `tenant_id` from `x-everr-tenant-id` and `retention_days` from `x-everr-retention-traces-days`.
- `gh-bad-signature`: a body signed with another secret returns `400 Invalid payload or signature` and writes nothing.
- `gh-unsigned`: a `GET` (no body, no signature) returns `400`. This is also the readiness probe in `process-compose.yaml`.
- `gh-skip-incomplete`: a `queued` `workflow_job` returns `204` and writes nothing.
- `gh-skip-event`: an event type the receiver does not handle (`ping`) returns `204`.
- `gh-ttl`: a delivery whose timestamps are older than the traces retention returns `202`, but the rows are dropped at insert.

## How to get to it (user POV)

- A GitHub App installation delivers `workflow_job` and `workflow_run` events to the application, which replays them to the collector.
- An operator replaying a stored delivery to the listener.

## Driving it with verify-collector

Preconditions:

- A run with `--profile cloud` or `--profile app` (`deploy/collector.yaml` has no GitHub listener).
- `$V doctor` prints `COLLECTOR DOCTOR OK`, including `GitHub listener answers an unsigned GET with 400`.
- `P=.agents/skills/verify-collector/scripts/workflow-job.webhook.json` (job `verify-collector-job` with steps `Set up job` and `Run tests`, installation `424242`).

- **Signed job.** Run `$V webhook gh-job workflow_job $P`. `--- HTTP 202`. The command block shows the replay headers and `timestamps shifted so the latest is now`.
- **Proof, spans.** Run `$V ch-until gh-job-rows verify-collector-job "SELECT SpanName, ServiceName, tenant_id, retention_days FROM app.traces WHERE ServiceName = 'github-actions' ORDER BY Timestamp"`. Three rows: `verify-collector-job`, `Set up job`, `Run tests`, each with tenant `verify-<RUN_ID>-a` and `retention_days` `14`.
- **Bad signature.** Run `$V webhook gh-bad-signature workflow_job $P --bad-signature`. `--- HTTP 400 Invalid payload or signature`.
- **Unsigned.** Run `eval "$($V env)"; $V http gh-unsigned GET "$GITHUB_WEBHOOK_URL"`. `--- HTTP 400`.
- **Skipped.** Run `$V webhook gh-skip-incomplete workflow_job collector/receiver/githubactionsreceiver/testdata/queued/1_workflow_job_queued.json` and `$V webhook gh-skip-event ping $P`. Both `--- HTTP 204`.
- **Retention TTL.** Run `$V webhook gh-ttl workflow_job $P --keep-times --tenant verify-ttl`. `--- HTTP 202` (the payload's 2026-10-20 times are older than 14 days). Then send a fresh delivery behind it, `$V webhook gh-ttl-after workflow_job $P --tenant verify-ttl-after` (`--- HTTP 202`), and wait for its rows: `$V ch-until gh-ttl-rows verify-ttl-after "SELECT tenant_id, toUInt8(count()) AS n FROM app.traces WHERE tenant_id LIKE 'verify-ttl%' GROUP BY tenant_id"`. One row, `verify-ttl-after` with `"n":3`, and no `verify-ttl` row. The later delivery is stored, so the exporter is past the expired one.
- **Proof, nothing else written.** Run `$V ch gh-only-job "SELECT tenant_id, toUInt8(count()) AS n FROM app.traces WHERE ServiceName = 'github-actions' GROUP BY tenant_id ORDER BY tenant_id"`. Two rows, tenant a and `verify-ttl-after`, each `"n":3`.

## Gotchas

- A `202` only means the delivery was accepted: the exporter writes later (1s batch timeout). A count of `0` read right after the `202` proves nothing, because the rows may not be written yet. Prove an absence only after a later delivery is visible (the `gh-ttl-after` step).
- `$V webhook` moves every ISO timestamp in the payload by one offset so the latest is now, then signs the result. Without that, fixture dates older than the retention make the rows vanish at insert while the listener still answers `202` (measured with `--keep-times`). The receiver's own fixtures under `testdata/completed/` also lack `installation.id`, so a completed one returns `400 Missing installation id`; use `$P` for completed events.
- `workflow_run` events, job logs and resource-usage metrics call the GitHub API with an installation token. This run's App id `1` and generated private key let the receiver start but cannot authenticate, so a completed `workflow_run` would reach `api.github.com` and fail. Prove those with [verify-web-app](../../verify-web-app/SKILL.md) and a real GitHub App.
- The application's side (verifying GitHub's original signature, mapping the installation to an organization, choosing the tenant and retention headers, retries) is not exercised here; `$V webhook` only reproduces the request it sends.
- With `--profile app` the headers are the same, because the development App returns a tenant.
