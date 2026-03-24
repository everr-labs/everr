# One pg.Client per SSE connection

## What
`createSubscription` in `packages/app/src/db/subscribe.ts` opens a dedicated `pg.Client` (not from the pool) for every active SSE connection. This includes one connection per browser tab (via `/api/events/subscribe`) and one per CLI `watch` session (via `/api/cli/runs/watch`).

Under concurrent users this creates many idle TCP connections against PostgreSQL's `max_connections` limit, each consuming server memory and a backend process.

## Where
`packages/app/src/db/subscribe.ts`

## Expected
A shared listener process that multiplexes pg LISTEN/NOTIFY notifications to in-process subscribers (e.g. via an EventEmitter map keyed by channel), so the number of Postgres connections is fixed regardless of connected SSE clients.

## Priority
medium

## Notes
The current pattern is correct for low concurrency and is the standard approach for LISTEN/NOTIFY. The concern is scaling — if many users or CLI sessions are active simultaneously, the connection count could approach PostgreSQL limits.
