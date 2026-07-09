# Clickety-Clack Frontend (in everr) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-16
**Repo:** everr (`packages/app`)
**Goal:** Build a UI for the clickety-clack alerting engine inside everr, living parallel to
everr's existing native alerting system so the two can be compared side by side.

---

## 1. Motivation

clickety-clack is a headless Rust alerting engine (rule evaluation over ClickHouse, durable
state in Postgres, work queues in Redis, an Alertmanager-style dispatcher) exposing a REST API
on `:8080`. It has no UI. everr already ships a native alerting system with its own evaluation
engine and a UI at `/alerts` + `/alerts/$id`. We want a second alerting UI — backed by
clickety-clack — mounted alongside the native one, so operators can compare the two systems on
the same data and the same screen real estate.

The new UI is a **self-contained parallel module** (chosen over a backend-toggle on the existing
pages, or a separate monorepo package). It reuses everr's auth, layout, nav, and `@everr/ui`
component library, but every clickety-clack-specific line is namespaced and isolated so the
comparison stays clean and the module can be removed without touching the native system.

## 2. Scope

**Surface exposed (full surface of CC, split by interaction model):**

- **Declarative via `everr apply` (read-only in the UI):** rules, receivers.
- **Full CRUD in the UI:** routes, inhibitions.
- **Operational actions in the UI:** silences (create/cancel), rule pause/resume.
- **Read / observe in the UI:** alerts (firing/pending instances), rule health, live event feed.
- **Minimal (create-only) in the UI:** subscriptions (CC exposes `POST` only).

**Out of scope (YAGNI):**
- Real CC authentication — CC is Phase-1 header-trust only; an env hook is left for later.
- Event history UI — CC currently has only a live SSE stream (see §6). History will land in
  ClickHouse later; this is a temporary state and the page is labeled as such.
- Full subscriptions management — CC's API is create-only for subscriptions.
- Any change to clickety-clack itself. (Note: the Rust `everr` CLI *does* need a small change to
  classify the two new resource kinds — see §5 — but nothing beyond kind routing.)

## 3. Architecture & data flow

The browser never talks to clickety-clack directly. CC's `X-CC-Tenant` is a trusted header that
must remain server-side, and everr is SSR-first with server-function RPC throughout. So:

```
React route/component
  → useQuery / useMutation
    → createAuthenticatedServerFn   (everr auth middleware: session + activeOrganizationId)
      → ccClient.<verb>(orgId, …)   (server-side fetch wrapper)
        → CC REST API  :8080  with  X-CC-Tenant: <orgId>
```

**Tenant mapping.** `session.session.activeOrganizationId` → `X-CC-Tenant`, applied in exactly
one place (the CC client). everr org IDs (UUIDs) satisfy CC's tenant regex
`^[A-Za-z0-9_.-]{1,64}$`, so no transformation is needed.

**The CC client** — `packages/app/src/lib/clickety-clack.server.ts`, following the
`telegram.server.ts` fetch pattern:
- private `ccFetch<Req,Res>(orgId, method, path, body?)` — sets `X-CC-Tenant`, JSON
  content-type, an `AbortSignal.timeout`, and maps CC's RFC-7807 error body
  (`{type,title,status,detail,code}`) into a typed `CcApiError`.
- typed verb wrappers on top: `listRules`, `getRule`, `pauseRule`, `resumeRule`, `testRule`,
  `listAlerts`, `listReceivers`, `getReceiver`, `upsertReceiver`, `deleteReceiver`,
  `listRoutes`, `createRoute`, `deleteRoute`, `listInhibitions`, `createInhibition`,
  `deleteInhibition`, `listSilences`, `createSilence`, `deleteSilence`,
  `createSubscription`, plus the create/delete used by the rule reconciler.
- all response shapes get **Zod schemas** (`data/cc/schema.ts`) matching CC's domain JSON, so
  server functions return validated, typed data — same discipline as the native alert server
  functions.

**Config** — `packages/app/src/env/clickety-clack.ts` (`@t3-oss/env-core` + Zod):
`CLICKETY_CLACK_BASE_URL` (`z.url()`). Added to the `extends` array in `env/index.ts`. No API
key configured (CC Phase-1 header-trust); a commented hook is left for when CC adds real auth.

**Code location (all namespaced for isolation / rip-out-ability):**

| Path | Responsibility |
|---|---|
| `packages/app/src/lib/clickety-clack.server.ts` | server-side CC REST client + `CcApiError` |
| `packages/app/src/env/clickety-clack.ts` | env schema (`CLICKETY_CLACK_BASE_URL`) |
| `packages/app/src/data/cc/schema.ts` | Zod schemas for CC domain JSON + apply resource kinds |
| `packages/app/src/data/cc/server.ts` | `createAuthenticatedServerFn` exports (queries + mutations) |
| `packages/app/src/data/cc/types.ts` | derived TS types |
| `packages/app/src/data/as-code/registry.ts` | register CC reconcilers (extends existing registry) |
| `packages/app/src/data/cc/apply.server.ts` | CC rule + receiver reconcilers |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/` | pages |
| `packages/app/src/routes/api/cc/events-stream.ts` | SSE proxy route |
| `packages/app/src/components/cc/` | shared CC components (e.g. `MatchersEditor`) |

## 4. Pages & navigation

A new collapsible nav section — **"Clickety-Clack"** — registered in `lib/navigation.ts`, sitting
next to the existing **"Alerts"** entry so the comparison is one click apart. All pages live
under `/cc-alerting/*`, reuse `@everr/ui` (DataTable, Card, Dialog, Badge, forms) and the
existing alert-page conventions. Where the native `-alerts-shared.tsx` helpers (`AlertStateBadges`,
`RelativeTime`, `QueryErrorMessage`, `formatInterval`, `stateVariant`) fit CC's shapes they are
reused; otherwise CC equivalents are added under `cc-alerting/-cc-shared.tsx`.

| Page | Route | Surface | Interactions |
|---|---|---|---|
| **Alerts** | `/cc-alerting/alerts` | Firing/pending instances (`GET /v1/alerts`) — headline page beside everr's `/alerts` | Read; row → "Silence this" shortcut; link to owning rule |
| **Rules** | `/cc-alerting/rules` | List with health badges (healthy/degraded) + paused state | Pause/Resume toggle |
| **Rule detail** | `/cc-alerting/rules/$id` | Spec (SQL, interval, for, labels, severity, annotations), health detail, this rule's firing instances | Pause/Resume; Test-eval panel (`POST /:id/test` → matched rows, no state change) |
| **Receivers** | `/cc-alerting/receivers` | Read-only list + detail, secrets redacted (`***`) | None (applied via CLI) |
| **Routes** | `/cc-alerting/routes` | List ordered by priority | Full CRUD |
| **Inhibitions** | `/cc-alerting/inhibitions` | List | Full CRUD |
| **Silences** | `/cc-alerting/silences` | List (active/expired) | Create / Cancel |
| **Events** | `/cc-alerting/events` | Live feed via SSE (`GET /v1/events/stream`) | Read; pause/clear; filter by severity/kind |
| **Settings** | `/cc-alerting/settings` | Minimal subscriptions create-only form | Create subscription |

Reused everr patterns: route loaders prefetch via `queryClient.prefetchQuery`; mutations use
`useMutation` + `sonner` toasts + `invalidateQueries`; forms use TanStack Form + Zod; breadcrumbs
via `staticData.breadcrumb`.

**Two asymmetries surfaced honestly in the UI (not hidden):**
- **Event history.** CC events are a *live* SSE stream only — events live transiently in
  Redis/Postgres outbox, there is no historical events endpoint. The native system reads event
  history from ClickHouse. The CC Events page is therefore a live tail, labeled as such, with a
  forward note that history will land in ClickHouse (at which point the page can gain a queryable
  history tab matching the native UX). **Temporary state.**
- **Subscriptions** (firehose webhooks) are create-only in CC (`POST` only — no list/delete), so
  they get a minimal create-only form on the Settings page, with the asymmetry noted inline.

## 5. The `everr apply` path (rules + receivers as-code)

Plugs into everr's existing generic apply pipeline: the Rust `everr apply <dir>` CLI loads YAML
resources + the `everr.yaml` manifest (`repoid` = ownership boundary), classifies each document
**by kind CLI-side** into typed state buckets, and POSTs to `/api/apply`, where the as-code
registry reconciles each bucket. A single `everr apply` over a mixed directory may contain native
`kind: AlertRule` and `kind: CCAlertRule`/`CCReceiver` side by side.

**The CLI is NOT kind-agnostic** — `classify_documents` in
`everr/crates/everr-core/src/apply.rs` hard-codes the supported kinds and errors on any unknown
kind, and `ApplyState` is a fixed-field struct. So adding the two CC kinds requires three
coordinated changes (the registry comment already mandates keeping these in sync):

1. **Rust CLI** (`crates/everr-core/src/apply.rs`): add `cc_rules` + `cc_receivers` fields to
   `ApplyState`/`ApplyStateDocs` (serialized `ccRules`/`ccReceivers` via the existing
   `#[serde(rename_all = "camelCase")]`), add `Some("CCAlertRule")`/`Some("CCReceiver")` match
   arms in `classify_documents`, and update the "unsupported kind" message + tests.
2. **Server `applyInput.state`** (`data/as-code/schema.ts`, currently `.strict()` with exactly
   `dashboards`/`alerts`): add `ccRules` and `ccReceivers` resource arrays.
3. **Registry** (`data/as-code/registry.ts`): add
   `{key: "ccRules", kind: "CCAlertRule", reconcile: applyCcRuleSpecs}` and
   `{key: "ccReceivers", kind: "CCReceiver", reconcile: applyCcReceiverSpecs}`.

**New resource kinds** (Zod schemas in `data/cc/schema.ts`, mirroring `AlertRuleYamlSchema`'s
`kind/metadata/spec` shape, `.strict()`):

```yaml
kind: CCAlertRule
metadata:
  name: high-error-rate          # stable identity → stored in CC rule annotations
spec:
  sql: "SELECT host FROM errors WHERE rate > 100"
  evaluationInterval: "30s"      # → interval_secs
  for: "60s"                     # → for_secs
  labelColumns: [host]
  valueColumn: rate
  severity: critical
  annotations: { runbook: "..." }
  resolveAfter: 2
---
kind: CCReceiver
metadata:
  name: oncall
spec:
  channel: { type: slack, url: "https://hooks.slack.com/..." }
```

Channel variants mirror CC's `ChannelConfig`: `{type: slack, url}`, `{type: email, to: [...]}`,
`{type: pagerduty, routing_key}`, `{type: webhook, url}`.

**Reconcilers** call CC's REST API instead of writing everr's DB. Idempotent
create/update/soft-delete keyed by the `repoid` ownership boundary — same contract as the native
alert reconciler:

- **Receivers — upsert-only (non-destructive).** CC `POST /v1/receivers` is upsert (keyed by
  name). Reconcile = upsert each desired. Unlike rules, CC receivers carry **no annotations**, so
  there is no way to scope ownership to this `repoid`; pruning "absent from config" would be
  tenant-wide and would delete receivers owned by other repos or created out-of-band. The
  reconciler therefore **never deletes** receivers — removal is a manual operation (UI/API). The
  Receivers page notes this.
- **Rules — the no-update wrinkle.** CC has create + delete but **no update** endpoint. Identity
  strategy: stamp `everr.name` and `everr.repoid` into the rule's `annotations` on create.
  Reconcile by listing rules and matching on those annotations:
  - in config, absent in CC → **create**
  - in both, spec changed → **delete + recreate** (CC rules are immutable post-create;
    `try_claim_eval` makes this safe — no torn state)
  - owned by `repoid`, absent from config → **delete**
  - unchanged → no-op (diff via stable-stringify of the normalized spec, like the native
    `needsUpdate()`)

  This keeps apply **stateless** — no everr-side mapping table; ownership truth lives in CC
  annotations, queried each run.

**Dry-run & ownership** come free from the existing pipeline: `--dry-run` renders the
create/update/delete plan; `repoid` scopes what this repo may touch, so CC objects created by
other means or other repos are never clobbered.

## 6. Live event stream (SSE proxy)

`GET /v1/events/stream` is SSE. The browser can't open it directly (tenant header is
server-side), so a thin everr API route (`routes/api/cc/events-stream.ts`, following the existing
`routes/api/` convention) opens the upstream CC stream server-side with `X-CC-Tenant` and pipes
events to the browser `EventSource`. The Events page consumes it with a small `useEventSource`
hook, holds a bounded in-memory ring buffer (last ~500 events), and offers pause/clear +
severity/kind filters. Event JSON shape (validated with Zod): `{tenant, rule, instance_key,
status, kind, labels, value, severity, annotations, eval_ts}`.

## 7. Live mutations in the UI

All via server functions → CC client; each with `useMutation` + `sonner` toast +
`invalidateQueries`; forms via TanStack Form + Zod.

- **Routes CRUD.** Form: matchers editor (label / op `eq|ne|regex|notregex` / value rows),
  `receiver` select (from `listReceivers`), `group_by` tags-input, `group_wait_secs`/
  `group_interval_secs`, `continue`, `priority`. CC has `POST` + `DELETE` but no route update →
  "edit" = delete + recreate behind one Save handler (the server function performs both and
  surfaces a single result). List ordered by priority.
- **Inhibitions CRUD.** Create/delete: matchers editor for source + target, plus `equal`
  tags-input. Edit = delete + recreate, same pattern.
- **Silences.** Create (matchers editor, starts/ends datetime, comment, author prefilled from
  session user) and cancel (`DELETE`). A **"Silence this"** shortcut from an alert row prefills
  matchers from that instance's labels — mirroring the native alert detail.
- **Rule pause/resume.** Toggle on the rules list + detail (`POST /:id/pause|/resume`), paused
  state reflected in a badge.

A shared `MatchersEditor` component (`components/cc/matchers-editor.tsx`) is reused across routes,
inhibitions, and silences — one well-bounded unit for the repeated label-matcher pattern.

## 8. Error handling

- CC's RFC-7807 error bodies map to a typed `CcApiError` in the client; server functions let it
  propagate; pages render it via a `QueryErrorMessage`-style component (reusing the native one).
- CC unreachable / timeout → a clear "clickety-clack API unavailable" empty-state, never a blank
  screen.
- CC validation errors (422) surface on the relevant form field.

## 9. Testing

- **Zod schemas** validate every CC response at the boundary.
- **Unit tests (Vitest):**
  - schema parsers (CC JSON → typed) for each domain object.
  - **apply reconcilers** (highest value — most subtle logic): create/update/delete planning,
    the rule delete-and-recreate path, annotation-based identity matching, and `repoid` ownership
    scoping — against a mocked CC client.
  - org → tenant mapping.
- **Component/page tests** follow existing native alert-page test conventions where present.

## 10. File map (summary)

| File | Change |
|---|---|
| `packages/app/src/env/clickety-clack.ts` | new — env schema |
| `packages/app/src/env/index.ts` | modify — extend with CC env |
| `packages/app/src/lib/clickety-clack.server.ts` | new — CC REST client + `CcApiError` |
| `packages/app/src/data/cc/schema.ts` | new — Zod schemas (domain + apply kinds) |
| `packages/app/src/data/cc/types.ts` | new — derived types |
| `packages/app/src/data/cc/server.ts` | new — server functions |
| `packages/app/src/data/cc/apply.server.ts` | new — rule + receiver reconcilers |
| `packages/app/src/data/as-code/registry.ts` | modify — register CC reconcilers |
| `packages/app/src/data/as-code/schema.ts` | modify — add `ccRules`/`ccReceivers` to `applyInput.state` |
| `everr/crates/everr-core/src/apply.rs` | modify — classify `CCAlertRule`/`CCReceiver` kinds |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/*` | new — pages |
| `packages/app/src/routes/api/cc/events-stream.ts` | new — SSE proxy |
| `packages/app/src/components/cc/matchers-editor.tsx` | new — shared matcher editor |
| `packages/app/src/lib/navigation.ts` | modify — add "Clickety-Clack" nav section |
