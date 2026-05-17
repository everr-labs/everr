# @everr/action

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
