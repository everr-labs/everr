Use Everr CLI from the current project directory to see what is wrong with CI.
When CI fails, use Everr to identify the failing workflow/job/step and inspect logs.

Quick commands:
- `everr status`: checks CI health, with info about recent runs for the current repo/branch (or the branch passed with flags).
- `everr runs list`
- `everr runs show --trace-id <trace_id>`
- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`
