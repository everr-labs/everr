---
"@everr/action": minor
---

Drop the `check-run-id` input. The action now self-discovers its own
check_run_id via the GitHub Jobs API using the workflow's GITHUB_TOKEN
(default `${{ github.token }}`), so external consumers no longer have
to plumb `${{ job.check_run_id }}` at every call site. Calling
workflows must grant `actions: read` permission. To override the
discovered token, pass `github-token` explicitly.
