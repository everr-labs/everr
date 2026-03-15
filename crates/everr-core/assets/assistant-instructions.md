Only use Everr CLI guidance when the task involves CI, GitHub Actions workflows, pipelines, CI failures, workflow logs, or CI test performance.

Use Everr CLI from the current project directory to see what is wrong with CI.
When CI fails, use Everr to identify the failing workflow/job/step and inspect logs.

Quick commands:
- `everr status`: returns the status of the runs on the current commit ;add `--commit <sha>` to target a specific commit
- `everr wait-pipeline`: waits for the pipeline related to the last commit on the current branch to complete; add `--commit <sha>` to target a specific commit
- `everr grep --job-name <job> --step-number <n> --pattern <text>`: searches failing step logs on other branches by default (7 days of history unless `--from/--to` are passed)
- `everr runs list`
- `everr runs show --trace-id <trace_id>`
- `everr runs logs --trace-id <trace_id> --job-name <job> --step-number <n>`
- `everr test-history --module <module> --test-name <name>`
- `everr slowest-tests`: shows repo-wide aggregates for non-suite tests by default; add `--branch <name>` to scope it
- `everr slowest-jobs`: shows repo-wide aggregates by default; add `--branch <name>` to scope it


Collection-style commands support `--limit <n>` and `--offset <n>` for pagination. `everr runs list` also keeps `--page <n>` for compatibility.

When `everr status` returns failures, inspect `status.failures[i].logsArgs` first. If it is present, call `everr runs logs` directly; otherwise use `everr runs show --trace-id <trace_id>` to discover the failing step.

Output schema notes:
- All commands print JSON.
- `status`: `{ status, repo, branch, latestPipeline, failures, message }`
- `status.failures[]`: `{ traceId, runId, workflowName, conclusion, durationMs, timestamp, failedStep?, logsArgs? }`
- `grep`: `{ repo, pattern, jobName, stepNumber, branch, excludedBranch, timeRange, limit, items }`
- `grep.items[]`: `{ branch, occurrenceCount, lastSeen, recentOccurrences }`
- `grep.items[].recentOccurrences[]`: `{ traceId, runId, runAttempt, workflowName, jobName, stepNumber, stepName, stepConclusion, runConclusion, stepDuration, timestamp, matchCount, matchedLines }`
- `runs list`: `{ runs, totalCount }`
- `runs show`: `{ run, jobs, steps }`
- `runs logs`: `{ logs }`
- `test-history`: array of `{ traceId, runId, runAttempt, headSha, headBranch, testResult, testDuration, runnerName, workflowName, jobName, timestamp }`
- `slowest-tests`: `{ repo, branch, timeRange, limit, items }` where `branch` is `null` for repo-wide results
- `slowest-tests.items[]`: `{ testPackage, testFullName, avgDurationSeconds, p95DurationSeconds, maxDurationSeconds, executions, passCount, failCount, skipCount, lastSeen }`
- `slowest-jobs`: `{ repo, branch, timeRange, limit, items }` where `branch` is `null` for repo-wide results
- `slowest-jobs.items[]`: `{ workflowName, jobName, avgDurationSeconds, p95DurationSeconds, maxDurationSeconds, executions, successCount, failureCount, skipCount, lastSeen }`
- `wait-pipeline`: `{ repo, branch, commit, pipelineFound, activeRuns, completedRuns }`
- `wait-pipeline.activeRuns[]` and `wait-pipeline.completedRuns[]`: `{ runId, workflowName, phase, conclusion, lastEventTime, durationSeconds, usualDurationSeconds, usualDurationSampleSize, activeJobs }`
