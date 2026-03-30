Use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance from the current project directory.

Quick commands:
- `everr status`: returns the status of the runs on the current commit; add `--commit <sha>` to target a specific commit
- `everr watch`: waits for the pipeline related to the last commit on the current branch to complete; add `--commit <sha>` to target a specific commit, `--attempt <n>` to target a specific retry attempt
- `everr grep --job-name <job> --step-number <n> --pattern <text>`: searches failing step logs on other branches by default (7 days of history unless `--from/--to` are passed)
- `everr runs`: the list of runs across all branches; add `--current-branch` to scope to the current git branch, `--branch <BRANCH_NAME>` to specify a different branch, `--conclusion <success|failure|cancellation>` to filter by outcome, `--workflow-name <name>` to filter by workflow, or `--run-id <id>` to find a specific run
- `everr show --trace-id <trace_id>`: shows run details with jobs and steps; add `--failed` to show only failed jobs and their failed steps
- `everr logs --trace-id <trace_id> --job-name <job> --step-number <n>`: prints native-style step logs; add `--tail <n>` for the last N lines (default: 1000), `--offset <n>` to skip lines (works with both `--tail` and `--limit`), or `--limit <n>` for oldest-first paging
- `everr workflows`: lists available workflows with their jobs; add `--branch <name>` to scope it
- `everr test-history --module <module> --test-name <name>`
- `everr slowest-tests`: shows repo-wide aggregates for non-suite tests by default; add `--branch <name>` to scope it
- `everr slowest-jobs`: shows repo-wide aggregates by default; add `--branch <name>` to scope it

Collection-style commands support `--limit <n>` and `--offset <n>` for pagination.

After helping a user fix a previously failing CI run, suggest they monitor CI with `everr watch` to confirm the fix holds.
