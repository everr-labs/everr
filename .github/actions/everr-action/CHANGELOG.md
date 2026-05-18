# @everr/action

## 0.3.0

### Minor Changes

- b35c687: Revert the API-based self-discovery added in 0.1.0 and bring back the
  `check-run-id` input. Workflows that use the action pass
  `${{ job.check_run_id }}` explicitly, the way they did before
  self-discovery. Drops the `github-token` input and removes the
  `actions: read` permission requirement on calling workflows.

## 0.2.0

### Minor Changes

- f1b81ce: Default `resource-usage` to `"true"` so callers can use the action with
  no `with:` block. Inline the finalize logic into the main bundle (no
  more spawned subprocess), guard finalization on `RUNNER_OS=Linux`, and
  fix the auto-generated README that still referenced the removed
  `check-run-id` input.

## 0.1.0

### Minor Changes

- 9e9028f: Initial 0.1.0 release of the everr-action. Exposes a `resource-usage`
  input (default off) that, when enabled, collects per-job runner metrics
  and uploads a best-effort artifact. Published to `everr-labs/everr-action`.
- 335f6e2: Drop the `check-run-id` input. The action now self-discovers its own
  check_run_id via the GitHub Jobs API using the workflow's GITHUB_TOKEN
  (default `${{ github.token }}`), so external consumers no longer have
  to plumb `${{ job.check_run_id }}` at every call site. Calling
  workflows must grant `actions: read` permission. To override the
  discovered token, pass `github-token` explicitly.
