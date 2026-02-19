# Pipeline Failure Attention Notifier

## Summary
Notify a developer immediately when a CI/CD pipeline they own starts failing, using their GitHub email to identify ownership.

## Goals
- Detect failing pipelines quickly.
- Alert only the relevant developer (owner).
- Minimize noisy or duplicate notifications.

## Non-goals
- Auto-fix pipelines.
- Team-wide incident management.
- Deep pipeline analytics.

## User Story
As a developer, if a pipeline I own fails, I get an attention-grabbing notification so I can act quickly.

## Ownership Resolution
- Identify current user email from app/session.
- Query GitHub user profile/emails via OAuth token.
- Match current user email to GitHub email list:
  - Prefer verified and primary email.
  - Fallback to any verified email match.
- Determine pipeline owner from pipeline metadata:
  - Last commit author email, PR author email, or configured owner field.
- Trigger only if owner email matches current user GitHub email.

## Failure Detection
- Inputs:
  - CI provider webhook events (preferred) or polling fallback.
- Trigger condition:
  - Pipeline status transitions to `failed` for a branch/PR the user owns.
- De-duplication:
  - One notification per pipeline run ID and failure state.
  - Cooldown window (for example, 30 minutes) to avoid alert storms.

## Notification Behavior
- Channels:
  - In-app toast and optional desktop/system notification.
- Content:
  - Repo, branch/PR, failed stage/job, failure time, direct link to logs.
- Priority:
  - High-attention style (sound/badge) only for first failure in cooldown window.

## Settings
- Enable/disable per user.
- Quiet hours.
- Channel preferences.
- Scope filters (repos/branches).

## Security and Privacy
- Store minimal email data (hashed where possible).
- Use least-privilege GitHub scopes (`read:user`, `user:email`).
- Do not expose private emails in notification payloads/logs.

## Edge Cases
- User has no public/verified GitHub email.
- Bot-authored commits.
- Multiple owners in monorepo pipelines.
- Pipeline reruns and flaky tests.

## Success Metrics
- Median time-to-notification after failure.
- Reduction in mean time-to-acknowledge.
- Alert precision (low false-positive rate).
- Notification opt-out/complaint rate.
