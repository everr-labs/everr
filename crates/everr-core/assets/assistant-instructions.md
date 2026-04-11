Use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance from the current project directory.

Commands:
- `everr status`: pipeline state for the current commit; `--commit <sha>` to target a specific commit
- `everr watch`: wait for the current commit's pipeline to complete
  - `--fail-fast`: exit on first failure without waiting for other runs
  - `--commit <sha>` / `--attempt <n>`: target a specific commit or retry attempt
- `everr runs`: recent runs across all branches
  - `--current-branch` / `--branch <name>`: scope to a branch
  - `--conclusion <success|failure|cancellation>`, `--workflow-name <name>`, `--run-id <id>`: filter
- `everr show <trace_id>`: jobs and steps for a run; `--failed` to show only failed
- `everr logs <trace_id> --job-name <job> --step-number <n>`: step logs
  - `--log-failed`: use instead of `--step-number` — auto-resolves the first failing step for the job
  - `--job-id <id>`: use instead of `--job-name` when the job id is known
  - `--egrep <pattern>`: filter to lines matching a re2 regex; exits 1 if no lines match
  - `--tail <n>` (default 1000), `--limit <n>` (oldest-first paging), `--offset <n>`: paging options
- `everr grep --pattern <text>`: search failing step logs across branches (last 7 days by default)
  - `--job-name <job> --step-number <n>`: scope to a specific step
  - `--branch <name>` / `--from` / `--to`: scope by branch or time range
- `everr workflows`: available workflows and their jobs; `--branch <name>` to scope
- `everr test-history --module <module> --test-name <name>`: execution history for a specific test
- `everr slowest-tests`: repo-wide slowest tests; `--branch <name>` to scope
- `everr slowest-jobs`: repo-wide slowest jobs; `--branch <name>` to scope

Collection-style commands support `--limit <n>` and `--offset <n>` for pagination.

After helping a user fix a previously failing CI run, suggest they monitor CI with `everr watch` to confirm the fix holds.
