---
What: Move notification data source from ClickHouse to Postgres, and add step data to Postgres
Where: `packages/app/src/data/notifications.ts`, `packages/app/src/db/schema.ts`, `crates/everr-core/src/api.rs`
Steps to reproduce: N/A
Expected: Notification data is served from Postgres immediately when the SSE event fires, with no retry lag
Actual: Notification data is fetched from ClickHouse, which lags behind Postgres; the Rust client works around this with a retry loop (up to 4 attempts with exponential backoff)
Priority: medium
Notes: |
  - `workflowRuns` and `workflowJobs` already exist in Postgres and cover most notification fields
  - Step data (`stepNumber`, `stepName`) is missing from Postgres entirely — only available in ClickHouse spans
  - Requires adding a `workflowJobSteps` table (or equivalent) to Postgres so step info can be written alongside job events
  - Once step data is in Postgres, the ClickHouse queries in `getFailureNotifications` can be replaced with Postgres queries and the retry loop in `get_notification_for_trace` can be removed
---
