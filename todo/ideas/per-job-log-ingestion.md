# Per-Job Log Ingestion

## What
Reduce the feedback loop by announcing failed jobs as soon as the `workflow_job` completed webhook arrives, along with the failure logs for that job.

## Why
Waiting for the full workflow run to complete delays useful feedback. Surfacing the failed job immediately, with its logs, would make CI failures much faster to notice and debug.

## Who
People using Everr to monitor CI runs and jump on failures quickly.

## Rough appetite
medium

## Notes
- This likely means fetching job-scoped logs from the `workflow_job` event path instead of waiting for the `workflow_run` completion path.
- Focus on failed jobs first so notifications stay timely and relevant.
