Use Everr CLI from the current project directory to see what is wrong with CI.
When CI fails, use Everr to identify the failing workflow/job/step and inspect logs.

Quick commands:
- `everr status`: checks CI health, with info about recent runs for the current repo/branch (or the branch passed with flags).
- `everr runs list`
- `everr runs show --trace-id <trace_id>`
- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`
- `everr test-history --module <module> --test-name <name>`
- `everr slowest-tests`
- `everr slowest-jobs`
- `everr wait-pipeline`: waits for the pipeline related to the last commit on the current branch to complete. Will probably take a while, CI normally take around 10/20 minutes
- `everr wait-pipeline --commit <sha>`

Output schema notes:
- All commands print JSON.
- `status`: `{ status, repo, branch, mainBranch, inspectedRuns, latestPipeline, failingPipelines, slowdown, message }`
- `runs list`: `{ runs, totalCount }`
- `runs show`: `{ run, jobs, steps }`
- `runs logs`: `{ logs }`
- `test-history`: array of `{ traceId, runId, runAttempt, headSha, headBranch, testResult, testDuration, runnerName, workflowName, jobName, timestamp }`
- `slowest-tests`: `{ repo, branch, timeRange, limit, items }`
- `slowest-tests.items[]`: `{ testPackage, testFullName, avgDurationSeconds, p95DurationSeconds, maxDurationSeconds, executions, passCount, failCount, skipCount, lastSeen }`
- `slowest-jobs`: `{ repo, branch, timeRange, limit, items }`
- `slowest-jobs.items[]`: `{ workflowName, jobName, avgDurationSeconds, p95DurationSeconds, maxDurationSeconds, executions, successCount, failureCount, skipCount, lastSeen }`
- `wait-pipeline`: `{ repo, branch, commit, pipelineFound, activeRuns, completedRuns }`
- `wait-pipeline.activeRuns[]` and `wait-pipeline.completedRuns[]`: `{ runId, workflowName, phase, conclusion, lastEventTime, durationSeconds, usualDurationSeconds, usualDurationSampleSize, activeJobs }`
