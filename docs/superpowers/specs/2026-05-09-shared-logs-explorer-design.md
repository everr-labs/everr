# Shared Logs Explorer (Webapp + Desktop)

**Date:** 2026-05-09
**Status:** Approved for planning

## Problem

The logs explorer UI currently lives only in the webapp at `packages/app/src/routes/_authenticated/_dashboard/logs.tsx` (~1374 lines), wired directly to TanStack Start server functions in `packages/app/src/data/logs-explorer/` that query the cloud ClickHouse cluster.

We want the same explorer in the desktop app, where logs come from the local CLI's embedded ClickHouse (chdb) — exposed via a SQL HTTP endpoint on `127.0.0.1:SQL_HTTP_PORT`. The webapp must keep working unchanged from the user's perspective. The 1374-line route is also too big to live in one file.

## Goals

- One source of truth for the logs explorer UI, consumed by both `@everr/app` (web) and `@everr/desktop-app` (Tauri).
- One source of truth for the SQL queries (chdb is ClickHouse-compatible, so the SQL is reusable verbatim).
- A working `/logs` page in the desktop app, querying local chdb via a Tauri command.
- Smaller, focused files — the current 1374-line route gets split as part of the move.

## Non-goals

- Per-run `log-viewer.tsx` (the run-detail view stays in the webapp for now).
- Auth/multi-tenancy on the local SQL endpoint (chdb is single-user).
- A cloud/local source switcher in the desktop app — desktop is local-only.
- Moving generic helpers (`time-range.ts`, `formatting.ts`) wholesale into the shared package; only the bits the package needs travel with it, kept self-contained inside the package.

## Architecture

### New package: `@everr/logs-explorer`

```
packages/logs-explorer/
  package.json
  tsconfig.json
  src/
    index.ts                  # public exports
    schemas.ts                # zod schemas + types (moved from app/data/logs-explorer)
    sql/
      queries.ts              # pure SQL builders + row mappers
                              # buildExplorerSql, buildHistogramSql, buildTotalsSql,
                              # buildDetailSql, buildFilterOptionsSql, mapRow*
      queries.test.ts
    data/
      client.ts               # SqlClient interface
      repository.ts           # LogsRepository wraps SqlClient with typed methods
      options.ts              # react-query option factories (take a repo)
    ui/
      logs-explorer.tsx       # the page-level component
      log-row.tsx
      log-inspector.tsx
      log-histogram.tsx
      log-filters.tsx
      ...                     # split out of the current 1374-line route
    context.tsx               # <LogsExplorerProvider>
```

External deps: `@everr/ui`, `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-router` (for `Link` type only), `recharts`, `react-virtuoso`, `ansi-to-react`, `lucide-react`, `zod`.

### The `SqlClient` boundary

The package is data-source-agnostic. The single seam between package and apps is:

```ts
export interface SqlClient {
  execute<Row>(sql: string, params: Record<string, unknown>): Promise<Row[]>
}
```

`LogsRepository` consumes a `SqlClient` and returns typed results validated against the existing zod schemas. React-query option factories take a repository.

### Webapp wiring

- `packages/app/src/data/logs-explorer/server.ts` becomes a shim:
  - A `ClickhouseSqlClient` that wraps `@clickhouse/client`.
  - The existing `createAuthenticatedServerFn` server functions stay (for auth + tenancy + SSR), but their bodies delegate to `LogsRepository(ClickhouseSqlClient)`.
  - The current hand-written SQL strings are replaced with calls to the package's builders.
- `packages/app/src/data/logs-explorer/options.ts` is replaced by a `RemoteSqlClient` (calls server fns over the network) plus calls into the package's option factories.
- `packages/app/src/routes/_authenticated/_dashboard/logs.tsx` shrinks to ~30 lines: search-param schema, instantiate the repo, render `<LogsExplorer />` with `renderRunLink` pointing at `/runs/$traceId/jobs/$jobId/steps/$stepNumber`.

### Desktop wiring

- **Rust side** (`packages/desktop-app/src-tauri/src/`): a new Tauri command `telemetry_sql_query(sql: String, params: serde_json::Value) -> Result<Vec<serde_json::Value>>` that posts to the local collector's SQL HTTP endpoint (`SQL_HTTP_PORT`). The transport logic is already in `packages/desktop-app/src-cli/src/telemetry/client.rs` — extract or reuse.
- **Frontend side** (`packages/desktop-app/src/features/logs/`):
  - `local-sql-client.ts` — `SqlClient` impl calling the Tauri command via `invoke`.
  - `logs-route.tsx` — TanStack Router route at `/logs`, owns search params, mounts `<LogsExplorer />`. `renderRunLink` returns `null` (no run-detail view in desktop yet).
- A `/logs` entry is added to the desktop nav (sidebar/menu in `desktop-shell`).

### Cross-app slots on `<LogsExplorer />`

| Prop | Required | Webapp | Desktop |
| --- | --- | --- | --- |
| `repo: LogsRepository` | yes | server-fn-backed repo | local-Tauri-backed repo |
| `timeRange: TimeRange` | yes | from URL search | from URL search |
| `searchState`, `onSearchChange` | yes | TanStack Router | TanStack Router |
| `renderRunLink?` | no | `<Link to="/runs/...">` | `null` |
| `availableSources?` | no | repo filter visible | repo filter hidden |

The route owns URL search-param state and timezone; the package never touches `window.history`.

### SQL portability

The current queries use `parseDateTimeBestEffort`, `multiIf`, `positionCaseInsensitive`, `lowerUTF8`, and `ResourceAttributes['vcs.repository.name']` — all standard ClickHouse, works in chdb. There are no `getSetting('SQL_everr_tenant_id')` calls in the current `server.ts` (tenancy is enforced by the cloud row-level policy), so the same SQL runs locally without modification.

## Components and data flow

```
  Webapp                                              Desktop
  ------                                              -------
  Browser                                             Tauri webview
  └─ <LogsExplorer repo={remoteRepo}>                 └─ <LogsExplorer repo={localRepo}>
       │ react-query                                       │ react-query
       ▼                                                   ▼
     RemoteSqlClient ── HTTPS ──► server fn          LocalSqlClient ── invoke ──► Tauri cmd
                                       │                                             │
                                       ▼                                             ▼
                                 ClickhouseSqlClient                          SQL HTTP (chdb)
                                       │                                             │
                                       ▼                                             ▼
                                 cloud ClickHouse                                local chdb
```

Both sides build SQL with the same `sql/queries.ts` builders and decode rows with the same mappers + zod schemas.

## Error handling

- `SqlClient.execute` rejects on transport failures; the repo wraps with a typed error class so the UI can distinguish "query failed" from "no results".
- Local desktop edge cases: collector not running, port not yet bound. The Tauri command surfaces a tagged error; the route renders an empty-state with retry guidance.
- Webapp keeps current behavior (server fn errors → react-query error states).

## Testing

- Pure SQL builders: unit tests in `packages/logs-explorer/src/sql/queries.test.ts`. Move/copy the relevant cases from `packages/app/src/data/logs-explorer/server.test.ts`.
- Repository: tests with a fake `SqlClient` that returns canned rows.
- UI components: minimal RTL coverage for the logs-explorer container plus the inspector — the existing webapp tests stay green after the route is rewired.
- Desktop: a Rust unit test for `telemetry_sql_query` against a mock HTTP server (mirrors the existing `client.rs` test pattern).
- Integration smoke: `pnpm dev:desktop` against a running local collector, verify rows + filters + histogram render.

## Migration plan

1. Scaffold `@everr/logs-explorer` (package.json, tsconfig, `pnpm-workspace` already covers `packages/*`).
2. Move `schemas.ts` into the package; re-export from the webapp via a thin barrel during transition.
3. Extract SQL into `sql/queries.ts` as pure functions. Port tests.
4. Add `SqlClient`, `LogsRepository`, and react-query option factories.
5. Split the 1374-line route into focused files inside `src/ui/`. Add `LogsExplorerProvider`/props for the repo and slots.
6. Refactor webapp: shim `server.ts` to delegate to the repo, replace `data/logs-explorer/options.ts`, slim down the route. Run tests.
7. Rust side: add `telemetry_sql_query` Tauri command, factoring transport logic out of `client.rs`. Add a unit test.
8. Desktop frontend: `LocalSqlClient`, `/logs` route, nav entry.
9. Smoke-test desktop end-to-end against a running local collector.

Each step lands in its own commit; steps 1–6 keep webapp green, steps 7–9 add the desktop side.

## Open follow-ups (not in this project)

- Per-run log-viewer extraction.
- Cloud/local source switcher in desktop.
- Sharing `time-range.ts` / `formatting.ts` properly across packages.
