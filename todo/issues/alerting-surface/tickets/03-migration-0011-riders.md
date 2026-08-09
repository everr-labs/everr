# 03: Migration 0011 riders

**What to build:** The PostgreSQL journal schema reaches its final shape
while migration 0011 is still unshipped. Schema only; the code that uses
it comes in later tickets. The engine keeps passing its tests unchanged.

**Details:** issue 5 in `../03-alerting-surface-plan.md`, and Changing the
schema in `../02-alerting-clickhouse-surface.md` (no `drizzle-kit
generate`).

**Blocked by:** 01 (the enum needs the terminal type name).

**Status:** ready-for-agent

- [x] The `kind` discriminator on the journal table
- [x] The event-type enum extended with pending, terminal and hold decision values, and `evaluation_failed` as a journaled state kind
- [x] The id default is a `uuidv7()` expression, not `defaultRandom()`
- [x] The episode id column on the journal tables, per Episodes and chain membership in the design doc
- [x] A PostgreSQL-stamped commit-side timestamp column on the journal tables
- [x] Folded into migration 0011 with the snapshot patched; applied to the dev database
- [x] Engine unit tests stay green
