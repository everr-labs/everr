# Failure notifications rely on polling instead of SSE

## What
The CLI failure notifications endpoint is polled on an interval. It should use the existing SSE infrastructure so notifications arrive in real time without repeated requests.

## Where
CLI notification polling logic, `/api/cli` notification routes

## Priority
medium

## Notes
The SSE plumbing already exists for watch. Notifications should subscribe to the same event stream and push failures as they happen.
