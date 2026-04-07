# logs-unavailable-for-in-progress-runs

**What:** When a user runs `everr logs` for a run that is in progress or just completed, the CLI may report that logs are unavailable even though they are about to arrive. There is no retry or wait mechanism — the command fails immediately.

**Where:** `packages/desktop-app/src-cli/src/core.rs` — `runs_logs` function

**Steps to reproduce:**
1. Start a CI run
2. Immediately run `everr logs --trace-id <id> --job-name <job> --step-number <n>`
3. CLI returns an error or empty result even though logs will be available shortly

**Expected:** CLI waits briefly or retries before giving up, similar to how `everr watch` polls for runs not yet found

**Actual:** CLI fails immediately with no indication that logs may be available soon

**Priority:** low

**Notes:** Most relevant for the auto-fix prompt flow, where the notifier fires `everr logs` shortly after a failure event — the step logs may not be indexed yet at that moment.
