---
"@everr/action": minor
---

Revert the API-based self-discovery added in 0.1.0 and bring back the
`check-run-id` input. Workflows that use the action pass
`${{ job.check_run_id }}` explicitly, the way they did before
self-discovery. Drops the `github-token` input and removes the
`actions: read` permission requirement on calling workflows.
