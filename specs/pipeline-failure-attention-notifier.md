# Pipeline Failure Attention Notifier

## Core Need
Developers push code and immediately move to another task. When CI fails a few minutes later, attention is elsewhere, context is gone, and recovery is slower.

This feature exists to pull attention back at the exact moment a developer-owned pipeline fails, so they can fix it while context is still fresh.

## User Problem
- I push code and get distracted.
- CI fails again.
- I only notice later, after I have lost focus and mental context.
- Fixing takes longer and interrupts my next task.

## Desired Outcome
- If my pipeline fails, I get an immediate, high-signal alert.
- The alert reaches me where I am (in-app and optional system notification).
- The alert includes a direct path to logs so I can act quickly.

## Ownership Match (GitHub Email)
- Resolve the current user identity from app/session.
- Fetch GitHub emails via OAuth (`read:user`, `user:email`).
- Match current user email to verified GitHub email (prefer primary).
- Consider a failing pipeline "mine" when pipeline owner email matches my GitHub email.

## Trigger
- On pipeline status transition to `failed`.
- Notify only when the failing pipeline is owned by the current user.
- Deduplicate by pipeline run ID and failure state to avoid repeated noise.

## Notification Requirements
- Must interrupt attention (high-priority signal).
- Must be immediate (seconds after failure event).
- Must include: repo, branch/PR, failed job/stage, failure time, and logs link.

## Success Criteria
- Lower time from CI failure to developer acknowledgment.
- Fewer failures discovered "late" after context switch.
- High relevance (very low false positives).
