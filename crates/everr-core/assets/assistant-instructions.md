Only use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance.

Use Everr CLI from the current project directory to see what is wrong with CI.
When CI fails, use Everr to identify the failing workflow/job/step and inspect logs.

Quick commands:
- `everr status`: returns the status of the runs on the current commit ;add `--commit <sha>` to target a specific commit
- `everr watch`: waits for the pipeline related to the last commit on the current branch to complete; add `--commit <sha>` to target a specific commit
- `everr grep --job-name <job> --step-number <n> --pattern <text>`: searches failing step logs on other branches by default (7 days of history unless `--from/--to` are passed)
- `everr runs list`
- `everr runs show --trace-id <trace_id>`
- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`
- `everr test-history --module <module> --test-name <name>`
- `everr slowest-tests`: shows repo-wide aggregates for non-suite tests by default; add `--branch <name>` to scope it
- `everr slowest-jobs`: shows repo-wide aggregates by default; add `--branch <name>` to scope it

Collection-style commands support `--limit <n>` and `--offset <n>` for pagination. `everr runs list` also keeps `--page <n>` for compatibility.
