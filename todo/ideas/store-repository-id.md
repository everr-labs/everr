# Store Repository ID

## What
Store the repositoryId to identify and associate data with specific repositories.

## Why
Having a stored repositoryId enables linking telemetry, runs, and other data back to the source repository reliably.

## Who
Developers and teams using Everr across different Git hosting platforms.

## Rough appetite
unknown

## Notes
- Need to investigate how repositoryId works across different Git providers:
  - GitHub (cloud) — standard repository ID via API
  - GitHub Enterprise — may use different ID schemes or self-hosted API endpoints
  - GitLab — uses its own project ID system, both SaaS and self-managed
- Key question: what is the canonical identifier that works universally, or do we need provider-specific handling?
