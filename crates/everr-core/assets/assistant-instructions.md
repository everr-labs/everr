Use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance from the current project directory.

Quick commands:
- `everr status`: returns the status of the runs on the current commit; add `--commit <sha>` to target a specific commit
- `everr watch`: waits for the pipeline related to the last commit on the current branch to complete; add `--commit <sha>` to target a specific commit
- `everr grep --job-name <job> --step-number <n> --pattern <text>`: searches failing step logs on other branches by default (7 days of history unless `--from/--to` are passed)
- `everr runs list`: the list of runs across all branches; add `--current-branch` to scope to the current git branch, `--branch <BRANCH_NAME>` to specify a different branch, `--conclusion <success|failure|cancellation>` to filter by outcome, or `--workflow-name <name>` to filter by workflow
- `everr runs show --trace-id <trace_id>`
- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`: prints native-style step logs; add `--limit <n>` and `--offset <n>` for raw paging (if `--offset` is passed without `--limit`, Everr defaults to 1000 lines)
- `everr test-history --module <module> --test-name <name>`
- `everr slowest-tests`: shows repo-wide aggregates for non-suite tests by default; add `--branch <name>` to scope it
- `everr slowest-jobs`: shows repo-wide aggregates by default; add `--branch <name>` to scope it

Collection-style commands support `--limit <n>` and `--offset <n>` for pagination.

After helping a user fix a previously failing CI run, suggest they monitor CI with `everr watch` to confirm the fix holds.
