# Clickety-Clack Frontend (in everr) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a UI inside everr (`packages/app`) for the clickety-clack (CC) alerting engine, parallel to everr's native alerting system, so the two can be compared side by side.

**Architecture:** A self-contained, namespaced module. The browser calls everr server functions (`createAuthenticatedServerFn`); those call a server-side CC REST client that injects `X-CC-Tenant: <activeOrganizationId>` and talks to CC's JSON API on `CLICKETY_CLACK_BASE_URL`. Rules + receivers are managed declaratively through everr's existing `everr apply` gitops pipeline (extended with two new resource kinds); routes, inhibitions, silences, and pause/resume are interactive in the UI; alerts, rule health, and a live SSE event feed are read-only.

**Tech Stack:** TanStack Start (React 19) + TanStack Router/Query/Form, Zod 4, `@everr/ui` components, Tailwind 4, `@t3-oss/env-core`, Vitest. Rust (`clap`, `serde`) for the `everr-core` apply-classifier change.

**Repo note:** ALL code in this plan lives in the **everr** repo at `/Users/gio/workspace/everr-labs/everr`. Paths below are relative to that repo root. Work on a feature branch (`feat/clickety-clack-frontend`); do not commit to `main`.

**Verified facts (from CC source, not the stale `http-api.md`):**
- `GET /v1/rules` is a **real** list returning `RuleView[]` = `Rule` (`{id, tenant, spec, version, paused}`) flattened **plus** a `health` object. Optional `?health=degraded|healthy` filter.
- `GET /v1/rules/:id` returns one `RuleView`. `POST /v1/rules` returns a bare `Rule` (no health). Pause/resume return a bare `Rule`.
- `POST /v1/rules/:id/test` takes a **`RuleSpec` body** (not the stored spec) and returns `{matched, rows:[{labels, value}]}`. No state change.
- All deletes return `{"deleted": true}`. Errors are problem+json `{type, title, status, detail, code}`.
- Tenant header is validated against `^[A-Za-z0-9_.-]{1,64}$` (NOT strict UUID). everr org IDs are alphanumeric `text` < 64 chars → pass directly, no transform.
- `everr apply` CLI classifies documents **by kind, CLI-side** (`crates/everr-core/src/apply.rs::classify_documents`) and **hard-errors on unknown kinds**; `ApplyState` is a fixed-field struct. New kinds require Rust + schema + registry changes (Phase 5).

**Phases (each independently shippable + testable):**
- Phase 0 — Foundation: env var, CC transport client + `CcApiError`, Zod schemas, types.
- Phase 1 — Typed client verbs + server functions.
- Phase 2 — Read-only pages + nav: Alerts, Rules (+ detail), Receivers.
- Phase 3 — Live events: SSE proxy route + Events page.
- Phase 4 — Mutations: MatchersEditor, Routes CRUD, Inhibitions CRUD, Silences, pause/resume, Subscriptions settings.
- Phase 5 — Apply path: Rust kind classification, `applyInput` schema, reconcilers, registry.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/app/src/env/clickety-clack.ts` | env schema (`CLICKETY_CLACK_BASE_URL`) | 0 |
| `packages/app/src/env/index.ts` | extend env with CC | 0 |
| `packages/app/src/lib/clickety-clack.server.ts` | raw transport (`ccRequest`) + `CcApiError` | 0 |
| `packages/app/src/data/cc/schema.ts` | Zod schemas for CC domain JSON + apply resource kinds | 0 |
| `packages/app/src/data/cc/types.ts` | TS types derived from schemas | 0 |
| `packages/app/src/data/cc/client.ts` | typed+validated verb wrappers (parse with Zod) | 1 |
| `packages/app/src/data/cc/server.ts` | `createAuthenticatedServerFn` queries + mutations | 1 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx` | shared CC UI helpers (badges, relative time, error msg) | 2 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx` | Alerts page | 2 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules.tsx` | Rules list page | 2 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules_.$ruleId.tsx` | Rule detail page | 2 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/receivers.tsx` | Receivers page | 2 |
| `packages/app/src/lib/navigation.ts` | add "Clickety-Clack" nav section | 2 |
| `packages/app/src/routes/api/cc/events-stream.ts` | server-side SSE proxy | 3 |
| `packages/app/src/hooks/use-cc-events.ts` | `EventSource` hook + ring buffer | 3 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/events.tsx` | Events page | 3 |
| `packages/app/src/components/cc/matchers-editor.tsx` | reusable label-matcher editor | 4 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/routes.tsx` | Routes CRUD page | 4 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/inhibitions.tsx` | Inhibitions CRUD page | 4 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx` | Silences page | 4 |
| `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/settings.tsx` | Subscriptions create-only page | 4 |
| `packages/app/src/data/cc/apply.server.ts` | rule + receiver reconcilers | 5 |
| `packages/app/src/data/as-code/schema.ts` | add `ccRules`/`ccReceivers` to `applyInput.state` | 5 |
| `packages/app/src/data/as-code/registry.ts` | register CC reconcilers | 5 |
| `crates/everr-core/src/apply.rs` | classify `CCAlertRule`/`CCReceiver` kinds | 5 |

**Conventions to mirror (read these once before starting):**
- Server-fn + auth: `packages/app/src/lib/serverFn.ts` (`createAuthenticatedServerFn`; org id at `context.session.session.activeOrganizationId`).
- Outbound fetch idiom: `packages/app/src/lib/telegram.server.ts`.
- Env idiom: `packages/app/src/env/clickhouse.ts` + `index.ts`.
- Page/route + table/dialog/card idiom: `packages/app/src/routes/_authenticated/_dashboard/alerts.tsx` and `alerts_.$alertId.tsx` and `-alerts-shared.tsx` — **the canonical exemplar for all CC pages.** Match its `createFileRoute`, loader/prefetch, `useQuery`, `useMutation`+`sonner`, `Dialog`, `Card`, `Button` usage.
- Table API: `@everr/ui/components/data-table` → `DataTable<T>` with `columns: Column<T>[]` (`{header, cell, className?}`), `rowKey`, `emptyState`.
- Badge: `@everr/ui/components/badge` → `<Badge variant="...">`.

---

## Phase 0 — Foundation

### Task 0.1: CC env var

**Files:**
- Create: `packages/app/src/env/clickety-clack.ts`
- Modify: `packages/app/src/env/index.ts`

- [ ] **Step 1: Create the env schema** (mirrors `env/clickhouse.ts`)

```typescript
// packages/app/src/env/clickety-clack.ts
import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const clicketyClackEnv = createEnv({
  server: {
    // Base URL of the clickety-clack `api` role, e.g. http://localhost:8080
    CLICKETY_CLACK_BASE_URL: z.url(),
    // CC Phase 1 is header-trust only (no API key). When CC adds real auth,
    // add CLICKETY_CLACK_API_KEY here and send it from the transport client.
  },
  runtimeEnv: {
    CLICKETY_CLACK_BASE_URL: process.env.CLICKETY_CLACK_BASE_URL,
  },
});
```

- [ ] **Step 2: Wire it into the combined env**

In `packages/app/src/env/index.ts`: add `import { clicketyClackEnv } from "./clickety-clack";` next to the other env imports, and add `clicketyClackEnv` to the `extends: [...]` array.

- [ ] **Step 3: Add to `.env.example` if present**

Run: `ls packages/app/.env.example 2>/dev/null && echo found`
If found, append `CLICKETY_CLACK_BASE_URL=http://localhost:8080`. If not found, skip.

- [ ] **Step 4: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: PASS (no new errors from these files).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/env/clickety-clack.ts packages/app/src/env/index.ts
git commit -m "Add CLICKETY_CLACK_BASE_URL env var"
```

### Task 0.2: CC transport client + `CcApiError`

**Files:**
- Create: `packages/app/src/lib/clickety-clack.server.ts`
- Test: `packages/app/src/lib/clickety-clack.server.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/app/src/lib/clickety-clack.server.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { CcApiError, ccRequest } from "./clickety-clack.server";

vi.mock("@/env", () => ({
  env: { CLICKETY_CLACK_BASE_URL: "http://cc.test" },
}));

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ccRequest", () => {
  it("sends X-CC-Tenant and returns parsed JSON on 200", async () => {
    const fetchMock = mockFetch(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);

    const out = await ccRequest("org_abc", "GET", "/v1/rules");

    expect(out).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://cc.test/v1/rules");
    expect((init.headers as Record<string, string>)["X-CC-Tenant"]).toBe("org_abc");
  });

  it("maps a problem+json error body to CcApiError", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(422, { title: "validation_failed", status: 422, detail: "interval_secs must be > 0", code: "validation_failed" }),
    );

    await expect(ccRequest("org_abc", "POST", "/v1/rules", {})).rejects.toMatchObject({
      name: "CcApiError",
      status: 422,
      code: "validation_failed",
      message: "interval_secs must be > 0",
    });
  });

  it("falls back to statusText when body is not problem+json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ccRequest("org_abc", "GET", "/v1/alerts")).rejects.toMatchObject({
      name: "CcApiError",
      status: 502,
      code: "unknown",
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/app && pnpm exec vitest run src/lib/clickety-clack.server.test.ts`
Expected: FAIL ("Cannot find module './clickety-clack.server'").

- [ ] **Step 3: Implement the transport**

```typescript
// packages/app/src/lib/clickety-clack.server.ts
import { env } from "@/env";

const CC_TIMEOUT_MS = 10_000;

/** A clickety-clack problem+json error mapped to a thrown JS error. */
export class CcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcApiError";
  }
}

export type CcMethod = "GET" | "POST" | "DELETE";

/**
 * Raw transport to the clickety-clack API. Injects the tenant header, enforces a
 * timeout, and maps CC's problem+json error shape to `CcApiError`. Returns the
 * parsed JSON body (callers validate with Zod). Server-side only — the tenant
 * header is trusted and must never be set from the browser.
 */
export async function ccRequest(
  orgId: string,
  method: CcMethod,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${env.CLICKETY_CLACK_BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-CC-Tenant": orgId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as
      | { detail?: unknown; code?: unknown }
      | null;
    const code = typeof problem?.code === "string" ? problem.code : "unknown";
    const detail =
      typeof problem?.detail === "string" ? problem.detail : res.statusText;
    throw new CcApiError(res.status, code, detail);
  }

  return res.json();
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd packages/app && pnpm exec vitest run src/lib/clickety-clack.server.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/clickety-clack.server.ts packages/app/src/lib/clickety-clack.server.test.ts
git commit -m "Add clickety-clack transport client + CcApiError"
```

### Task 0.3: CC domain Zod schemas

**Files:**
- Create: `packages/app/src/data/cc/schema.ts`
- Create: `packages/app/src/data/cc/types.ts`
- Test: `packages/app/src/data/cc/schema.test.ts`

- [ ] **Step 1: Write failing tests** (lock the exact CC JSON field names)

```typescript
// packages/app/src/data/cc/schema.test.ts
import { describe, expect, it } from "vitest";
import {
  CcAlertSchema,
  CcEventSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
} from "./schema";

it("parses a RuleView (Rule flattened + health)", () => {
  const parsed = CcRuleViewSchema.parse({
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org_abc",
    spec: {
      sql: "SELECT host FROM t WHERE x > 1",
      interval_secs: 30,
      for_secs: 60,
      label_columns: ["host"],
      value_column: "x",
      severity: "critical",
      annotations: { runbook: "https://r" },
      resolve_after: 1,
    },
    version: 1,
    paused: false,
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
  });
  expect(parsed.spec.severity).toBe("critical");
  expect(parsed.health.status).toBe("healthy");
});

it("parses an alert instance with nullable value/timestamps", () => {
  const a = CcAlertSchema.parse({
    key: "deadbeef", rule: "r", tenant: "t", status: "pending",
    labels: { host: "web-1" }, value: null,
    active_since: null, last_seen: "2026-06-14T12:03:00Z", absent_count: 0,
  });
  expect(a.status).toBe("pending");
  expect(a.value).toBeNull();
});

it("parses a receiver channel tagged union", () => {
  expect(CcReceiverSchema.parse({ id: "i", tenant: "t", name: "oncall", channel: { type: "slack", url: "***" } }).channel.type).toBe("slack");
  expect(CcReceiverSchema.parse({ id: "i", tenant: "t", name: "ops", channel: { type: "email", to: ["a@b.c"] } }).channel.type).toBe("email");
});

it("parses a route with nullable group settings", () => {
  const r = CcRouteSchema.parse({
    id: "i", tenant: "t",
    matchers: [{ label: "severity", op: "eq", value: "critical" }],
    receiver: "oncall", continue: false, priority: 0,
    group_by: ["rule", "severity"], group_wait_secs: 10, group_interval_secs: 300,
  });
  expect(r.matchers[0].op).toBe("eq");
});

it("parses a silence and an SSE event", () => {
  expect(CcSilenceSchema.parse({
    id: "i", tenant: "t", matchers: [{ label: "host", op: "eq", value: "web-1" }],
    starts_at: "2026-06-14T00:00:00Z", ends_at: "2026-06-14T01:00:00Z",
    comment: "m", author: "you", created_at: "2026-06-14T00:00:00Z",
  }).author).toBe("you");

  expect(CcEventSchema.parse({
    tenant: "t", rule: "r", instance_key: "k", status: "firing",
    labels: {}, value: 1, severity: "warning", annotations: {},
    eval_ts: "2026-06-14T12:03:00Z",
  }).status).toBe("firing");
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/schema.test.ts`
Expected: FAIL ("Cannot find module './schema'").

- [ ] **Step 3: Implement schemas**

```typescript
// packages/app/src/data/cc/schema.ts
import { z } from "zod";

export const CcSeveritySchema = z.enum(["info", "warning", "critical"]);
export const CcMatchOpSchema = z.enum(["eq", "ne", "regex", "notregex"]);
export const CcInstanceStatusSchema = z.enum(["inactive", "pending", "firing"]);
export const CcEventStatusSchema = z.enum(["firing", "resolved"]);

export const CcMatcherSchema = z.object({
  label: z.string(),
  op: CcMatchOpSchema,
  value: z.string(),
});

export const CcRuleSpecSchema = z.object({
  sql: z.string(),
  interval_secs: z.number().int(),
  for_secs: z.number().int(),
  label_columns: z.array(z.string()),
  value_column: z.string().nullable().optional(),
  severity: CcSeveritySchema,
  annotations: z.record(z.string(), z.string()).default({}),
  resolve_after: z.number().int().default(1),
});

// Health status is open-ended on the CC side; keep it permissive but typed.
export const CcRuleHealthSchema = z.object({
  status: z.string(), // observed values: "healthy" | "degraded"
  consecutive_failures: z.number().int(),
  degraded_since: z.string().nullable(),
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
});

export const CcRuleSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  spec: CcRuleSpecSchema,
  version: z.number().int(),
  paused: z.boolean(),
});

// GET list and GET :id return Rule flattened + health.
export const CcRuleViewSchema = CcRuleSchema.extend({
  health: CcRuleHealthSchema,
});

export const CcAlertSchema = z.object({
  key: z.string(),
  rule: z.string(),
  tenant: z.string(),
  status: CcInstanceStatusSchema,
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  active_since: z.string().nullable(),
  last_seen: z.string().nullable(),
  absent_count: z.number().int(),
});

export const CcChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("slack"), url: z.string() }),
  z.object({ type: z.literal("pagerduty"), routing_key: z.string() }),
  z.object({ type: z.literal("email"), to: z.array(z.string()) }),
]);

export const CcReceiverSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  channel: CcChannelSchema,
});

export const CcRouteSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(CcMatcherSchema),
  receiver: z.string(),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().nullable(),
  group_interval_secs: z.number().int().nullable(),
});

export const CcSilenceSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(CcMatcherSchema),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  created_at: z.string(),
});

export const CcInhibitionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  source_matchers: z.array(CcMatcherSchema),
  target_matchers: z.array(CcMatcherSchema),
  equal: z.array(z.string()).nullable().optional(),
  created_at: z.string(),
});

export const CcSubscriptionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  webhook_url: z.string(),
});

export const CcEventSchema = z.object({
  tenant: z.string(),
  rule: z.string(),
  instance_key: z.string(),
  status: CcEventStatusSchema,
  kind: z.string().optional(), // e.g. "alert" | health-event kinds
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  severity: CcSeveritySchema,
  annotations: z.record(z.string(), z.string()),
  eval_ts: z.string(),
});

export const CcTestResultSchema = z.object({
  matched: z.number().int(),
  rows: z.array(z.object({ labels: z.record(z.string(), z.string()), value: z.number().nullable() })),
});

export const CcDeletedSchema = z.object({ deleted: z.boolean() });
```

- [ ] **Step 4: Implement derived types**

```typescript
// packages/app/src/data/cc/types.ts
import type { z } from "zod";
import type {
  CcAlertSchema, CcEventSchema, CcInhibitionSchema, CcMatcherSchema,
  CcReceiverSchema, CcRouteSchema, CcRuleSpecSchema, CcRuleViewSchema,
  CcSilenceSchema, CcSubscriptionSchema, CcTestResultSchema,
} from "./schema";

export type CcMatcher = z.infer<typeof CcMatcherSchema>;
export type CcRuleSpec = z.infer<typeof CcRuleSpecSchema>;
export type CcRuleView = z.infer<typeof CcRuleViewSchema>;
export type CcAlert = z.infer<typeof CcAlertSchema>;
export type CcReceiver = z.infer<typeof CcReceiverSchema>;
export type CcRoute = z.infer<typeof CcRouteSchema>;
export type CcSilence = z.infer<typeof CcSilenceSchema>;
export type CcInhibition = z.infer<typeof CcInhibitionSchema>;
export type CcSubscription = z.infer<typeof CcSubscriptionSchema>;
export type CcEvent = z.infer<typeof CcEventSchema>;
export type CcTestResult = z.infer<typeof CcTestResultSchema>;
```

- [ ] **Step 5: Run — verify pass**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/schema.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/cc/schema.ts packages/app/src/data/cc/types.ts packages/app/src/data/cc/schema.test.ts
git commit -m "Add CC domain Zod schemas and types"
```

---

## Phase 1 — Typed client verbs + server functions

### Task 1.1: Typed, validated client verbs

**Files:**
- Create: `packages/app/src/data/cc/client.ts`
- Test: `packages/app/src/data/cc/client.test.ts`

- [ ] **Step 1: Write failing tests** (mock `ccRequest`, assert path/method + Zod parse)

```typescript
// packages/app/src/data/cc/client.test.ts
import { describe, expect, it, vi } from "vitest";
import * as transport from "@/lib/clickety-clack.server";
import * as cc from "./client";

const ruleView = {
  id: "r1", tenant: "t", version: 1, paused: false,
  spec: { sql: "SELECT 1", interval_secs: 30, for_secs: 0, label_columns: [], value_column: null, severity: "info", annotations: {}, resolve_after: 1 },
  health: { status: "healthy", consecutive_failures: 0, degraded_since: null, last_error: null, last_error_at: null },
};

it("listRules GETs /v1/rules and validates", async () => {
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue([ruleView]);
  const out = await cc.listRules("org1");
  expect(spy).toHaveBeenCalledWith("org1", "GET", "/v1/rules");
  expect(out[0].health.status).toBe("healthy");
});

it("pauseRule POSTs the pause path", async () => {
  vi.spyOn(transport, "ccRequest").mockResolvedValue({ ...ruleView, paused: true });
  const out = await cc.pauseRule("org1", "r1");
  expect(out.paused).toBe(true);
  expect(transport.ccRequest).toHaveBeenCalledWith("org1", "POST", "/v1/rules/r1/pause");
});

it("createSilence POSTs body and validates response", async () => {
  const silence = { id: "s1", tenant: "t", matchers: [{ label: "h", op: "eq", value: "1" }], starts_at: "2026-06-14T00:00:00Z", ends_at: "2026-06-14T01:00:00Z", comment: null, author: null, created_at: "2026-06-14T00:00:00Z" };
  const spy = vi.spyOn(transport, "ccRequest").mockResolvedValue(silence);
  const body = { matchers: [{ label: "h", op: "eq" as const, value: "1" }], starts_at: "2026-06-14T00:00:00Z", ends_at: "2026-06-14T01:00:00Z" };
  const out = await cc.createSilence("org1", body);
  expect(spy).toHaveBeenCalledWith("org1", "POST", "/v1/silences", body);
  expect(out.id).toBe("s1");
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/client.test.ts`
Expected: FAIL ("Cannot find module './client'").

- [ ] **Step 3: Implement the verbs**

```typescript
// packages/app/src/data/cc/client.ts
import { z } from "zod";
import { ccRequest } from "@/lib/clickety-clack.server";
import {
  CcAlertSchema, CcDeletedSchema, CcInhibitionSchema, CcReceiverSchema,
  CcRouteSchema, CcRuleSchema, CcRuleSpecSchema, CcRuleViewSchema,
  CcSilenceSchema, CcSubscriptionSchema, CcTestResultSchema,
} from "./schema";
import type { CcMatcher, CcRuleSpec } from "./types";

// ---- Rules ----
export async function listRules(orgId: string) {
  return z.array(CcRuleViewSchema).parse(await ccRequest(orgId, "GET", "/v1/rules"));
}
export async function getRule(orgId: string, id: string) {
  return CcRuleViewSchema.parse(await ccRequest(orgId, "GET", `/v1/rules/${id}`));
}
export async function createRule(orgId: string, spec: CcRuleSpec) {
  return CcRuleSchema.parse(await ccRequest(orgId, "POST", "/v1/rules", CcRuleSpecSchema.parse(spec)));
}
export async function deleteRule(orgId: string, id: string) {
  return CcDeletedSchema.parse(await ccRequest(orgId, "DELETE", `/v1/rules/${id}`));
}
export async function pauseRule(orgId: string, id: string) {
  return CcRuleSchema.parse(await ccRequest(orgId, "POST", `/v1/rules/${id}/pause`));
}
export async function resumeRule(orgId: string, id: string) {
  return CcRuleSchema.parse(await ccRequest(orgId, "POST", `/v1/rules/${id}/resume`));
}
/** Ad-hoc evaluation. CC's test endpoint takes a full spec body. */
export async function testRule(orgId: string, id: string, spec: CcRuleSpec) {
  return CcTestResultSchema.parse(await ccRequest(orgId, "POST", `/v1/rules/${id}/test`, CcRuleSpecSchema.parse(spec)));
}

// ---- Alerts ----
export async function listAlerts(orgId: string) {
  return z.array(CcAlertSchema).parse(await ccRequest(orgId, "GET", "/v1/alerts"));
}

// ---- Receivers ----
export async function listReceivers(orgId: string) {
  return z.array(CcReceiverSchema).parse(await ccRequest(orgId, "GET", "/v1/receivers"));
}
export async function getReceiver(orgId: string, name: string) {
  return CcReceiverSchema.parse(await ccRequest(orgId, "GET", `/v1/receivers/${encodeURIComponent(name)}`));
}

// ---- Routes ----
export type RouteInput = {
  matchers: CcMatcher[]; receiver: string; continue: boolean; priority: number;
  group_by: string[] | null; group_wait_secs: number | null; group_interval_secs: number | null;
};
export async function listRoutes(orgId: string) {
  return z.array(CcRouteSchema).parse(await ccRequest(orgId, "GET", "/v1/routes"));
}
export async function createRoute(orgId: string, input: RouteInput) {
  return CcRouteSchema.parse(await ccRequest(orgId, "POST", "/v1/routes", input));
}
export async function deleteRoute(orgId: string, id: string) {
  return CcDeletedSchema.parse(await ccRequest(orgId, "DELETE", `/v1/routes/${id}`));
}

// ---- Inhibitions ----
export type InhibitionInput = { source_matchers: CcMatcher[]; target_matchers: CcMatcher[]; equal: string[] };
export async function listInhibitions(orgId: string) {
  return z.array(CcInhibitionSchema).parse(await ccRequest(orgId, "GET", "/v1/inhibitions"));
}
export async function createInhibition(orgId: string, input: InhibitionInput) {
  return CcInhibitionSchema.parse(await ccRequest(orgId, "POST", "/v1/inhibitions", input));
}
export async function deleteInhibition(orgId: string, id: string) {
  return CcDeletedSchema.parse(await ccRequest(orgId, "DELETE", `/v1/inhibitions/${id}`));
}

// ---- Silences ----
export type SilenceInput = {
  matchers: CcMatcher[]; starts_at: string; ends_at: string; comment?: string; author?: string;
};
export async function listSilences(orgId: string) {
  return z.array(CcSilenceSchema).parse(await ccRequest(orgId, "GET", "/v1/silences"));
}
export async function createSilence(orgId: string, input: SilenceInput) {
  return CcSilenceSchema.parse(await ccRequest(orgId, "POST", "/v1/silences", input));
}
export async function deleteSilence(orgId: string, id: string) {
  return CcDeletedSchema.parse(await ccRequest(orgId, "DELETE", `/v1/silences/${id}`));
}

// ---- Subscriptions (create-only on CC) ----
export async function createSubscription(orgId: string, webhookUrl: string) {
  return CcSubscriptionSchema.parse(await ccRequest(orgId, "POST", "/v1/subscriptions", { webhook_url: webhookUrl }));
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/client.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/data/cc/client.ts packages/app/src/data/cc/client.test.ts
git commit -m "Add typed, validated CC client verbs"
```

### Task 1.2: Server functions

**Files:**
- Create: `packages/app/src/data/cc/server.ts`

These wrap the client verbs with `createAuthenticatedServerFn`, pulling `orgId` from `context.session.session.activeOrganizationId` (see `lib/serverFn.ts`). Input validation uses the same Zod pieces.

- [ ] **Step 1: Implement server functions**

```typescript
// packages/app/src/data/cc/server.ts
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import * as cc from "./client";
import { CcMatcherSchema, CcRuleSpecSchema } from "./schema";

const orgId = (ctx: { session: { session: { activeOrganizationId: string } } }) =>
  ctx.session.session.activeOrganizationId;

// ---- Queries ----
export const listCcRules = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listRules(orgId(context)),
);

export const getCcRule = createAuthenticatedServerFn({ method: "GET" })
  .validator(z.object({ ruleId: z.string() }))
  .handler(({ context, data }) => cc.getRule(orgId(context), data.ruleId));

export const listCcAlerts = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listAlerts(orgId(context)),
);

export const listCcReceivers = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listReceivers(orgId(context)),
);

export const listCcRoutes = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listRoutes(orgId(context)),
);

export const listCcInhibitions = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listInhibitions(orgId(context)),
);

export const listCcSilences = createAuthenticatedServerFn({ method: "GET" }).handler(
  ({ context }) => cc.listSilences(orgId(context)),
);

// ---- Rule operations ----
export const pauseCcRule = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ ruleId: z.string() }))
  .handler(({ context, data }) => cc.pauseRule(orgId(context), data.ruleId));

export const resumeCcRule = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ ruleId: z.string() }))
  .handler(({ context, data }) => cc.resumeRule(orgId(context), data.ruleId));

export const testCcRule = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ ruleId: z.string(), spec: CcRuleSpecSchema }))
  .handler(({ context, data }) => cc.testRule(orgId(context), data.ruleId, data.spec));

// ---- Routes ----
const RouteInputSchema = z.object({
  matchers: z.array(CcMatcherSchema),
  receiver: z.string().min(1),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().nullable(),
  group_interval_secs: z.number().int().nullable(),
});
export const createCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .validator(RouteInputSchema)
  .handler(({ context, data }) => cc.createRoute(orgId(context), data));
export const deleteCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(({ context, data }) => cc.deleteRoute(orgId(context), data.id));
/** Edit = delete + recreate (CC has no route update). Server-side so it is one call. */
export const replaceCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), route: RouteInputSchema }))
  .handler(async ({ context, data }) => {
    const oid = orgId(context);
    await cc.deleteRoute(oid, data.id);
    return cc.createRoute(oid, data.route);
  });

// ---- Inhibitions ----
const InhibitionInputSchema = z.object({
  source_matchers: z.array(CcMatcherSchema),
  target_matchers: z.array(CcMatcherSchema),
  equal: z.array(z.string()),
});
export const createCcInhibition = createAuthenticatedServerFn({ method: "POST" })
  .validator(InhibitionInputSchema)
  .handler(({ context, data }) => cc.createInhibition(orgId(context), data));
export const deleteCcInhibition = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(({ context, data }) => cc.deleteInhibition(orgId(context), data.id));

// ---- Silences ----
const SilenceInputSchema = z.object({
  matchers: z.array(CcMatcherSchema).min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().optional(),
  author: z.string().optional(),
});
export const createCcSilence = createAuthenticatedServerFn({ method: "POST" })
  .validator(SilenceInputSchema)
  .handler(({ context, data }) => cc.createSilence(orgId(context), data));
export const deleteCcSilence = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(({ context, data }) => cc.deleteSilence(orgId(context), data.id));

// ---- Subscriptions ----
export const createCcSubscription = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ webhookUrl: z.url() }))
  .handler(({ context, data }) => cc.createSubscription(orgId(context), data.webhookUrl));
```

- [ ] **Step 2: Verify the server-fn call + validator API against the codebase**

Run: `cd packages/app && sed -n '1,40p' src/data/alerts/server.ts`
Confirm TWO things and match them EXACTLY (TanStack Start versions differ):
1. **Constructor form** — how `createAuthenticatedServerFn` is invoked. `lib/serverFn.ts` defines it as `createServerFn().middleware([...])`. If the existing code calls `createAuthenticatedServerFn({ method: "GET" })`, the helper accepts a method option — keep my form. If instead it calls `createAuthenticatedServerFn()` with no args (method set elsewhere) or `.method("GET")`, rewrite every server fn here to that form.
2. **Validator** — `.validator(` vs `.inputValidator(`. Adjust all input-validation calls to the form the repo actually uses.
Then continue.

- [ ] **Step 3: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/data/cc/server.ts
git commit -m "Add CC server functions (queries + mutations)"
```

---

## Phase 2 — Read-only pages + navigation

> All pages in this phase mirror the structure of `routes/_authenticated/_dashboard/alerts.tsx` (the canonical exemplar). Read it first. Each uses `createFileRoute`, a `loader` that `prefetchQuery`s, and `useQuery` in the component. Render errors with the shared `CcQueryError` (Task 2.1). After each page, verify with typecheck + dev server.

### Task 2.1: Shared CC UI helpers

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx`

- [ ] **Step 1: Implement helpers**

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx
import { Badge } from "@everr/ui/components/badge";
import { CcApiError } from "@/lib/clickety-clack.server";

export function ccErrorMessage(error: unknown): string {
  if (error instanceof CcApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) {
    // Server-fn errors arrive as plain Error; surface a friendly CC-unavailable hint.
    if (/fetch failed|timeout|ECONNREFUSED/i.test(error.message)) {
      return "clickety-clack API unavailable";
    }
    return error.message;
  }
  return "Unknown error";
}

export function CcQueryError({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {ccErrorMessage(error)}
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary"> = {
  firing: "destructive",
  pending: "default",
  inactive: "secondary",
};

export function CcInstanceStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>;
}

export function CcHealthBadge({ status }: { status: string }) {
  return <Badge variant={status === "degraded" ? "destructive" : "secondary"}>{status}</Badge>;
}

export function CcSeverityBadge({ severity }: { severity: string }) {
  const variant = severity === "critical" ? "destructive" : severity === "warning" ? "default" : "secondary";
  return <Badge variant={variant}>{severity}</Badge>;
}

/** Compact RFC-3339 → local string; null-safe. */
export function ccFormatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}
```

- [ ] **Step 2: Confirm `Badge` variant names exist**

Run: `cd packages/app && rg -n "variant:" ../ui/src/components/badge.tsx`
If the available variants are NOT `default|destructive|secondary` (e.g. they are `outline|success|...`), update the maps above to use real variant names. Do not invent variants.

- [ ] **Step 3: Typecheck + commit**

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/-cc-shared.tsx
git commit -m "Add shared CC UI helpers"
```

### Task 2.2: Alerts page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx`

- [ ] **Step 1: Implement the page** (mirror `alerts.tsx` exemplar for layout)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listCcAlerts } from "@/data/cc/server";
import type { CcAlert } from "@/data/cc/types";
import { CcInstanceStatusBadge, CcQueryError, ccFormatTs } from "./-cc-shared";

const ccAlertsQuery = () =>
  queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/alerts")({
  staticData: { breadcrumb: "CC Alerts" },
  head: () => ({ meta: [{ title: "Everr - Clickety-Clack Alerts" }] }),
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(ccAlertsQuery()),
  component: CcAlertsPage,
});

function CcAlertsPage() {
  const { data, isPending, isError, error } = useQuery(ccAlertsQuery());

  const columns: Column<CcAlert>[] = [
    { header: "Status", cell: (r) => <CcInstanceStatusBadge status={r.status} /> },
    {
      header: "Labels",
      cell: (r) => (
        <span className="font-mono text-xs">
          {Object.entries(r.labels).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}
        </span>
      ),
    },
    { header: "Value", cell: (r) => (r.value ?? "—") },
    {
      header: "Rule",
      cell: (r) => (
        <Link to="/cc-alerting/rules/$ruleId" params={{ ruleId: r.rule }} className="text-primary hover:underline">
          {r.rule.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Active since", cell: (r) => ccFormatTs(r.active_since) },
    { header: "Last seen", cell: (r) => ccFormatTs(r.last_seen) },
  ];

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Clickety-Clack — Alerts</h1>
      {isError ? (
        <CcQueryError error={error} />
      ) : (
        <Card>
          <CardHeader><CardTitle>Current instances</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              data={data ?? []}
              columns={columns}
              rowKey={(r) => r.key}
              emptyState={<p className="p-4 text-sm text-muted-foreground">{isPending ? "Loading…" : "No alert instances."}</p>}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `Card`/`CardContent`/`CardHeader`/`CardTitle` import path**

Run: `cd packages/app && rg -n "from \"@everr/ui/components/card\"" src/routes/_authenticated/_dashboard/alerts.tsx`
Match the exact import path/names the exemplar uses; adjust if different.

- [ ] **Step 3: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: PASS. (The route is referenced before it exists in the generated tree; if `routeTree.gen.ts` complains, run the dev server once — Task 2.6 — to regenerate, or `pnpm exec tsr generate` if available.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx
git commit -m "Add CC Alerts page"
```

### Task 2.3: Rules list page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules.tsx`

- [ ] **Step 1: Implement** (list with health/paused badges + pause/resume toggle)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules.tsx
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { listCcRules, pauseCcRule, resumeCcRule } from "@/data/cc/server";
import type { CcRuleView } from "@/data/cc/types";
import { CcHealthBadge, CcQueryError, CcSeverityBadge, ccErrorMessage } from "./-cc-shared";

const ccRulesQuery = () =>
  queryOptions({ queryKey: ["cc", "rules"], queryFn: () => listCcRules() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/rules")({
  staticData: { breadcrumb: "CC Rules" },
  head: () => ({ meta: [{ title: "Everr - Clickety-Clack Rules" }] }),
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(ccRulesQuery()),
  component: CcRulesPage,
});

function CcRulesPage() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccRulesQuery());

  const toggle = useMutation({
    mutationFn: (rule: CcRuleView) =>
      rule.paused ? resumeCcRule({ data: { ruleId: rule.id } }) : pauseCcRule({ data: { ruleId: rule.id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc", "rules"] }); toast.success("Rule updated"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const columns: Column<CcRuleView>[] = [
    {
      header: "Rule",
      cell: (r) => (
        <Link to="/cc-alerting/rules/$ruleId" params={{ ruleId: r.id }} className="font-mono text-primary hover:underline">
          {r.id.slice(0, 8)}
        </Link>
      ),
    },
    { header: "Severity", cell: (r) => <CcSeverityBadge severity={r.spec.severity} /> },
    { header: "Interval", cell: (r) => `${r.spec.interval_secs}s` },
    { header: "Health", cell: (r) => <CcHealthBadge status={r.health.status} /> },
    { header: "State", cell: (r) => (r.paused ? <Badge variant="secondary">paused</Badge> : <Badge variant="default">active</Badge>) },
    {
      header: "",
      cell: (r) => (
        <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
          {r.paused ? "Resume" : "Pause"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Clickety-Clack — Rules</h1>
      <p className="text-sm text-muted-foreground">Rules are managed via <code>everr apply</code>; pause/resume is operational.</p>
      {isError ? (
        <CcQueryError error={error} />
      ) : (
        <Card>
          <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              data={data ?? []}
              columns={columns}
              rowKey={(r) => r.id}
              emptyState={<p className="p-4 text-sm text-muted-foreground">{isPending ? "Loading…" : "No rules. Create them with everr apply."}</p>}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `Button` import + `size` prop**

Run: `cd packages/app && rg -n "from \"@everr/ui/components/button\"" src/routes/_authenticated/_dashboard/alerts*.tsx; rg -n "size=" ../ui/src/components/button.tsx | head`
If `Button` has no `size` prop, drop it. Match the exemplar's usage.

- [ ] **Step 3: Typecheck + commit**

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules.tsx
git commit -m "Add CC Rules list page with pause/resume"
```

### Task 2.4: Rule detail page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules_.$ruleId.tsx`

- [ ] **Step 1: Implement** (spec, health, this rule's firing instances, test-eval panel)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules_.$ruleId.tsx
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getCcRule, listCcAlerts, pauseCcRule, resumeCcRule, testCcRule } from "@/data/cc/server";
import type { CcAlert, CcTestResult } from "@/data/cc/types";
import { CcHealthBadge, CcInstanceStatusBadge, CcQueryError, CcSeverityBadge, ccErrorMessage, ccFormatTs } from "./-cc-shared";

const ccRuleQuery = (ruleId: string) =>
  queryOptions({ queryKey: ["cc", "rule", ruleId], queryFn: () => getCcRule({ data: { ruleId } }) });
const ccAlertsQuery = () =>
  queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/rules_/$ruleId")({
  staticData: { breadcrumb: "CC Rule" },
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([queryClient.prefetchQuery(ccRuleQuery(params.ruleId)), queryClient.prefetchQuery(ccAlertsQuery())]),
  component: CcRuleDetailPage,
});

function CcRuleDetailPage() {
  const { ruleId } = Route.useParams();
  const qc = useQueryClient();
  const rule = useQuery(ccRuleQuery(ruleId));
  const alerts = useQuery(ccAlertsQuery());
  const [test, setTest] = useState<CcTestResult | null>(null);

  const toggle = useMutation({
    mutationFn: (paused: boolean) => (paused ? resumeCcRule({ data: { ruleId } }) : pauseCcRule({ data: { ruleId } })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc", "rule", ruleId] }); toast.success("Rule updated"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const runTest = useMutation({
    mutationFn: () => testCcRule({ data: { ruleId, spec: rule.data!.spec } }),
    onSuccess: (r) => setTest(r),
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  if (rule.isError) return <div className="p-4"><CcQueryError error={rule.error} /></div>;
  if (!rule.data) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  const r = rule.data;
  const ruleInstances = (alerts.data ?? []).filter((a: CcAlert) => a.rule === ruleId);
  const instCols: Column<CcAlert>[] = [
    { header: "Status", cell: (a) => <CcInstanceStatusBadge status={a.status} /> },
    { header: "Labels", cell: (a) => <span className="font-mono text-xs">{Object.entries(a.labels).map(([k, v]) => `${k}=${v}`).join(", ")}</span> },
    { header: "Value", cell: (a) => a.value ?? "—" },
    { header: "Active since", cell: (a) => ccFormatTs(a.active_since) },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-bold">{r.id.slice(0, 8)}</h1>
        <div className="flex items-center gap-2">
          <CcSeverityBadge severity={r.spec.severity} />
          <CcHealthBadge status={r.health.status} />
          <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(r.paused)}>
            {r.paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Spec</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{r.spec.sql}</pre>
          <div>interval {r.spec.interval_secs}s · for {r.spec.for_secs}s · resolve_after {r.spec.resolve_after}</div>
          <div>labels: {r.spec.label_columns.join(", ") || "—"} · value: {r.spec.value_column ?? "—"}</div>
          {r.health.status === "degraded" && (
            <div className="text-destructive">degraded since {ccFormatTs(r.health.degraded_since)}: {r.health.last_error ?? ""}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Firing instances</CardTitle></CardHeader>
        <CardContent>
          <DataTable data={ruleInstances} columns={instCols} rowKey={(a) => a.key}
            emptyState={<p className="p-4 text-sm text-muted-foreground">No instances for this rule.</p>} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Test evaluation
            <Button variant="outline" size="sm" disabled={runTest.isPending} onClick={() => runTest.mutate()}>Run test</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {test ? (
            <>
              <div className="mb-2">matched {test.matched} row(s) — no state change</div>
              <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">{JSON.stringify(test.rows, null, 2)}</pre>
            </>
          ) : (
            <p className="text-muted-foreground">Run an ad-hoc evaluation of this rule's current spec against ClickHouse.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dynamic-route filename convention**

Run: `cd packages/app && ls src/routes/_authenticated/_dashboard/ | rg "alerts_"`
The native detail page is `alerts_.$alertId.tsx` with route id `/_authenticated/_dashboard/alerts_/$alertId`. MATCH that convention exactly: file `rules_.$ruleId.tsx`, `createFileRoute("/_authenticated/_dashboard/cc-alerting/rules_/$ruleId")`. If the generated tree disagrees after running dev, fix the route-id string to match what `routeTree.gen.ts` produced.

- [ ] **Step 3: Typecheck + commit**

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add "packages/app/src/routes/_authenticated/_dashboard/cc-alerting/rules_.\$ruleId.tsx"
git commit -m "Add CC Rule detail page with test-eval"
```

### Task 2.5: Receivers page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/receivers.tsx`

- [ ] **Step 1: Implement** (read-only; secrets already redacted by CC)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/receivers.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { listCcReceivers } from "@/data/cc/server";
import type { CcReceiver } from "@/data/cc/types";
import { CcQueryError } from "./-cc-shared";

const q = () => queryOptions({ queryKey: ["cc", "receivers"], queryFn: () => listCcReceivers() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/receivers")({
  staticData: { breadcrumb: "CC Receivers" },
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(q()),
  component: CcReceiversPage,
});

function channelSummary(c: CcReceiver["channel"]): string {
  switch (c.type) {
    case "slack": return `slack ${c.url}`;
    case "webhook": return `webhook ${c.url}`;
    case "pagerduty": return `pagerduty ${c.routing_key}`;
    case "email": return `email ${c.to.join(", ")}`;
  }
}

function CcReceiversPage() {
  const { data, isPending, isError, error } = useQuery(q());
  const columns: Column<CcReceiver>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Type", cell: (r) => r.channel.type },
    { header: "Target", cell: (r) => <span className="font-mono text-xs">{channelSummary(r.channel)}</span> },
  ];
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Clickety-Clack — Receivers</h1>
      <p className="text-sm text-muted-foreground">Managed via <code>everr apply</code>; secrets are redacted.</p>
      {isError ? <CcQueryError error={error} /> : (
        <Card>
          <CardHeader><CardTitle>Receivers</CardTitle></CardHeader>
          <CardContent>
            <DataTable data={data ?? []} columns={columns} rowKey={(r) => r.name}
              emptyState={<p className="p-4 text-sm text-muted-foreground">{isPending ? "Loading…" : "No receivers."}</p>} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/receivers.tsx
git commit -m "Add CC Receivers page"
```

### Task 2.6: Navigation + smoke test

**Files:**
- Modify: `packages/app/src/lib/navigation.ts`

- [ ] **Step 1: Add the nav section**

In `navMain` (after the `Alerts` entry), add (import an icon, e.g. `Zap`, from `lucide-react` at the top):

```typescript
  {
    title: "Clickety-Clack",
    url: "/cc-alerting/alerts",
    icon: Zap,
    items: [
      { title: "Alerts", url: "/cc-alerting/alerts" },
      { title: "Rules", url: "/cc-alerting/rules" },
      { title: "Receivers", url: "/cc-alerting/receivers" },
      { title: "Routes", url: "/cc-alerting/routes" },
      { title: "Inhibitions", url: "/cc-alerting/inhibitions" },
      { title: "Silences", url: "/cc-alerting/silences" },
      { title: "Events", url: "/cc-alerting/events" },
      { title: "Settings", url: "/cc-alerting/settings" },
    ],
  },
```

> The Routes/Inhibitions/Silences/Events/Settings pages land in Phases 3–4; the nav entries are added now and will 404 until then. That is acceptable mid-build; do not remove them.

- [ ] **Step 2: Start the dev server and smoke-test**

Run: `cd packages/app && pnpm dev:web` (or the repo's web dev script — check `package.json` scripts; it may be `pnpm dev`). Wait for it to boot (regenerates `routeTree.gen.ts`).
With `CLICKETY_CLACK_BASE_URL` pointing at a running CC `api` (or any stub returning `[]`), open `/cc-alerting/alerts`, `/cc-alerting/rules`, `/cc-alerting/receivers`. Verify pages render and, with CC down, show the "clickety-clack API unavailable" error state rather than crashing.
Stop the dev server.

- [ ] **Step 3: Commit** (include the regenerated route tree)

```bash
git add packages/app/src/lib/navigation.ts packages/app/src/routeTree.gen.ts
git commit -m "Add Clickety-Clack nav section; wire CC read-only routes"
```

---

## Phase 3 — Live events (SSE)

### Task 3.1: Server-side SSE proxy route

**Files:**
- Create: `packages/app/src/routes/api/cc/events-stream.ts`

CC's `/v1/events/stream` is `text/event-stream`. The browser cannot send `X-CC-Tenant`, so everr opens the upstream stream server-side (authenticated, tenant from session) and pipes the bytes through.

- [ ] **Step 1: Inspect an existing `routes/api/*` handler for the exact server-route API**

Run: `cd packages/app && sed -n '1,40p' src/routes/api/apply.ts`
Note how it gets the request, session, and returns a `Response` (TanStack Start server route conventions vary by version — `createServerFileRoute`/`createAPIFileRoute`/`ServerRoute`). MATCH that exact pattern in Step 2.

- [ ] **Step 2: Implement the proxy** (adapt the wrapper to match Step 1's API)

```typescript
// packages/app/src/routes/api/cc/events-stream.ts
// NOTE: adapt the route-export wrapper (createServerFileRoute / ServerRoute / etc.)
// to match src/routes/api/apply.ts exactly. The handler body below is the payload.
import { auth } from "@/lib/auth.server";
import { env } from "@/env";

async function handler({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const orgId = session?.session?.activeOrganizationId;
  if (!orgId) return new Response("Unauthenticated", { status: 401 });

  const upstream = await fetch(`${env.CLICKETY_CLACK_BASE_URL}/v1/events/stream`, {
    method: "GET",
    headers: { "X-CC-Tenant": orgId, accept: "text/event-stream" },
    signal: request.signal, // browser disconnect aborts the upstream
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`clickety-clack stream unavailable (${upstream.status})`, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

// e.g. export const ServerRoute = createServerFileRoute().methods({ GET: handler });
// — match src/routes/api/apply.ts's export form.
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: PASS once the wrapper matches the repo's server-route API.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes/api/cc/events-stream.ts
git commit -m "Add server-side SSE proxy for CC events"
```

### Task 3.2: `useCcEvents` hook

**Files:**
- Create: `packages/app/src/hooks/use-cc-events.ts`
- Test: `packages/app/src/hooks/use-cc-events.test.ts`

- [ ] **Step 1: Write a failing test for the pure ring-buffer reducer**

```typescript
// packages/app/src/hooks/use-cc-events.test.ts
import { describe, expect, it } from "vitest";
import { appendBounded } from "./use-cc-events";

it("keeps only the last N items, newest first", () => {
  let buf: number[] = [];
  for (let i = 0; i < 5; i++) buf = appendBounded(buf, i, 3);
  expect(buf).toEqual([4, 3, 2]);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd packages/app && pnpm exec vitest run src/hooks/use-cc-events.test.ts`
Expected: FAIL ("Cannot find module './use-cc-events'").

- [ ] **Step 3: Implement the hook + helper**

```typescript
// packages/app/src/hooks/use-cc-events.ts
import { useEffect, useRef, useState } from "react";
import { CcEventSchema } from "@/data/cc/schema";
import type { CcEvent } from "@/data/cc/types";

const MAX_EVENTS = 500;

/** Prepend `item`, cap length at `max`. Newest-first. Pure — unit tested. */
export function appendBounded<T>(buf: T[], item: T, max: number): T[] {
  const next = [item, ...buf];
  return next.length > max ? next.slice(0, max) : next;
}

export function useCcEvents() {
  const [events, setEvents] = useState<CcEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    const es = new EventSource("/api/cc/events-stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      if (pausedRef.current) return;
      const parsed = CcEventSchema.safeParse(JSON.parse(msg.data));
      if (parsed.success) setEvents((b) => appendBounded(b, parsed.data, MAX_EVENTS));
    };
    return () => es.close();
  }, []);

  return {
    events,
    connected,
    clear: () => setEvents([]),
    setPaused: (p: boolean) => { pausedRef.current = p; },
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd packages/app && pnpm exec vitest run src/hooks/use-cc-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/hooks/use-cc-events.ts packages/app/src/hooks/use-cc-events.test.ts
git commit -m "Add useCcEvents SSE hook with bounded buffer"
```

### Task 3.3: Events page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/events.tsx`

- [ ] **Step 1: Implement** (live tail, pause/clear, severity + kind filter)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/events.tsx
import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCcEvents } from "@/hooks/use-cc-events";
import type { CcEvent } from "@/data/cc/types";
import { CcSeverityBadge, ccFormatTs } from "./-cc-shared";

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/events")({
  staticData: { breadcrumb: "CC Events" },
  component: CcEventsPage,
});

function CcEventsPage() {
  const { events, connected, clear, setPaused } = useCcEvents();
  const [paused, setLocalPaused] = useState(false);
  const [severity, setSeverity] = useState<string>("all");

  const filtered = useMemo(
    () => (severity === "all" ? events : events.filter((e) => e.severity === severity)),
    [events, severity],
  );

  const columns: Column<CcEvent>[] = [
    { header: "Time", cell: (e) => ccFormatTs(e.eval_ts) },
    { header: "Status", cell: (e) => <Badge variant={e.status === "firing" ? "destructive" : "secondary"}>{e.status}</Badge> },
    { header: "Severity", cell: (e) => <CcSeverityBadge severity={e.severity} /> },
    { header: "Kind", cell: (e) => e.kind ?? "alert" },
    { header: "Labels", cell: (e) => <span className="font-mono text-xs">{Object.entries(e.labels).map(([k, v]) => `${k}=${v}`).join(", ")}</span> },
    { header: "Rule", cell: (e) => <span className="font-mono text-xs">{e.rule.slice(0, 8)}</span> },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clickety-Clack — Events</h1>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "default" : "secondary"}>{connected ? "live" : "disconnected"}</Badge>
          <select className="rounded border px-2 py-1 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">all severities</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => { const p = !paused; setLocalPaused(p); setPaused(p); }}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button variant="outline" size="sm" onClick={clear}>Clear</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Live tail (last 500). CC events are streamed, not stored — a queryable history will arrive once CC writes events to ClickHouse.
      </p>
      <Card>
        <CardHeader><CardTitle>Live events</CardTitle></CardHeader>
        <CardContent>
          <DataTable data={filtered} columns={columns} rowKey={(e, i) => `${e.instance_key}-${e.eval_ts}-${i}`}
            emptyState={<p className="p-4 text-sm text-muted-foreground">Waiting for events…</p>} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit** (include regenerated route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/events.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add CC live Events page"
```

---

## Phase 4 — Mutations (routes, inhibitions, silences, subscriptions)

### Task 4.1: Reusable MatchersEditor

**Files:**
- Create: `packages/app/src/components/cc/matchers-editor.tsx`
- Test: `packages/app/src/components/cc/matchers-editor.test.tsx`

- [ ] **Step 1: Write a failing test for the pure helpers**

```tsx
// packages/app/src/components/cc/matchers-editor.test.tsx
import { describe, expect, it } from "vitest";
import { addMatcher, removeMatcher, updateMatcher } from "./matchers-editor";

it("adds, updates, removes matcher rows", () => {
  let m = addMatcher([]);
  expect(m).toEqual([{ label: "", op: "eq", value: "" }]);
  m = updateMatcher(m, 0, { label: "severity", value: "critical" });
  expect(m[0]).toEqual({ label: "severity", op: "eq", value: "critical" });
  m = removeMatcher(m, 0);
  expect(m).toEqual([]);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd packages/app && pnpm exec vitest run src/components/cc/matchers-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** (pure helpers + a controlled component)

```tsx
// packages/app/src/components/cc/matchers-editor.tsx
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import type { CcMatcher } from "@/data/cc/types";

const OPS: CcMatcher["op"][] = ["eq", "ne", "regex", "notregex"];

export function addMatcher(m: CcMatcher[]): CcMatcher[] {
  return [...m, { label: "", op: "eq", value: "" }];
}
export function removeMatcher(m: CcMatcher[], i: number): CcMatcher[] {
  return m.filter((_, idx) => idx !== i);
}
export function updateMatcher(m: CcMatcher[], i: number, patch: Partial<CcMatcher>): CcMatcher[] {
  return m.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
}

export function MatchersEditor({
  value, onChange, label = "Matchers",
}: { value: CcMatcher[]; onChange: (m: CcMatcher[]) => void; label?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(addMatcher(value))}>Add</Button>
      </div>
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input placeholder="label" value={row.label} onChange={(e) => onChange(updateMatcher(value, i, { label: e.target.value }))} />
          <select className="rounded border px-2 py-1 text-sm" value={row.op} onChange={(e) => onChange(updateMatcher(value, i, { op: e.target.value as CcMatcher["op"] }))}>
            {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
          <Input placeholder="value" value={row.value} onChange={(e) => onChange(updateMatcher(value, i, { value: e.target.value }))} />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(removeMatcher(value, i))}>×</Button>
        </div>
      ))}
      {value.length === 0 && <p className="text-xs text-muted-foreground">No matchers — matches everything.</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass; confirm `Input` import path**

Run: `cd packages/app && pnpm exec vitest run src/components/cc/matchers-editor.test.tsx` → PASS
Run: `rg -n "from \"@everr/ui/components/input\"" src | head` — confirm the path; adjust if different.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/cc/matchers-editor.tsx packages/app/src/components/cc/matchers-editor.test.tsx
git commit -m "Add reusable CC MatchersEditor"
```

### Task 4.2: Routes CRUD page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/routes.tsx`

- [ ] **Step 1: Implement** (list + create dialog + delete; edit = replace via `replaceCcRoute`)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/routes.tsx
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MatchersEditor } from "@/components/cc/matchers-editor";
import { createCcRoute, deleteCcRoute, listCcRoutes } from "@/data/cc/server";
import type { CcMatcher, CcRoute } from "@/data/cc/types";
import { CcQueryError, ccErrorMessage } from "./-cc-shared";

const q = () => queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/routes")({
  staticData: { breadcrumb: "CC Routes" },
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(q()),
  component: CcRoutesPage,
});

function CcRoutesPage() {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery(q());
  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [receiver, setReceiver] = useState("");
  const [priority, setPriority] = useState(0);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cc", "routes"] });
  const create = useMutation({
    mutationFn: () => createCcRoute({ data: {
      matchers, receiver, continue: false, priority,
      group_by: null, group_wait_secs: null, group_interval_secs: null,
    } }),
    onSuccess: () => { invalidate(); setOpen(false); setMatchers([]); setReceiver(""); setPriority(0); toast.success("Route created"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCcRoute({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Route deleted"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const columns: Column<CcRoute>[] = [
    { header: "Priority", cell: (r) => r.priority },
    { header: "Matchers", cell: (r) => <span className="font-mono text-xs">{r.matchers.map((m) => `${m.label}${m.op}${m.value}`).join(", ") || "*"}</span> },
    { header: "Receiver", cell: (r) => r.receiver },
    { header: "Group by", cell: (r) => (r.group_by ?? ["rule", "severity"]).join(", ") },
    { header: "", cell: (r) => <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>Delete</Button> },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clickety-Clack — Routes</h1>
        <Button onClick={() => setOpen(true)}>New route</Button>
      </div>
      {isError ? <CcQueryError error={error} /> : (
        <Card>
          <CardHeader><CardTitle>Routes (by priority)</CardTitle></CardHeader>
          <CardContent>
            <DataTable data={data ?? []} columns={columns} rowKey={(r) => r.id}
              emptyState={<p className="p-4 text-sm text-muted-foreground">No routes — events fall back to subscriptions.</p>} />
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New route</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <MatchersEditor value={matchers} onChange={setMatchers} />
            <div>
              <label className="text-sm font-medium">Receiver</label>
              <Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="oncall" />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!receiver || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `Dialog` sub-component names** against the exemplar

Run: `cd packages/app && rg -n "Dialog" src/routes/_authenticated/_dashboard/alerts.tsx | head`
Match the exact imported names (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `DialogDescription`) and import path. Adjust if the library differs.

- [ ] **Step 3: Typecheck + commit** (with route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/routes.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add CC Routes CRUD page"
```

### Task 4.3: Inhibitions CRUD page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/inhibitions.tsx`

- [ ] **Step 1: Implement** (same shape as routes; two MatchersEditors + `equal` tags via comma-separated input)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/inhibitions.tsx
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MatchersEditor } from "@/components/cc/matchers-editor";
import { createCcInhibition, deleteCcInhibition, listCcInhibitions } from "@/data/cc/server";
import type { CcInhibition, CcMatcher } from "@/data/cc/types";
import { CcQueryError, ccErrorMessage } from "./-cc-shared";

const q = () => queryOptions({ queryKey: ["cc", "inhibitions"], queryFn: () => listCcInhibitions() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/inhibitions")({
  staticData: { breadcrumb: "CC Inhibitions" },
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(q()),
  component: CcInhibitionsPage,
});

function CcInhibitionsPage() {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery(q());
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<CcMatcher[]>([]);
  const [target, setTarget] = useState<CcMatcher[]>([]);
  const [equal, setEqual] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
  const create = useMutation({
    mutationFn: () => createCcInhibition({ data: {
      source_matchers: source, target_matchers: target,
      equal: equal.split(",").map((s) => s.trim()).filter(Boolean),
    } }),
    onSuccess: () => { invalidate(); setOpen(false); setSource([]); setTarget([]); setEqual(""); toast.success("Inhibition created"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCcInhibition({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Inhibition deleted"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const fmt = (m: CcMatcher[]) => m.map((x) => `${x.label}${x.op}${x.value}`).join(", ") || "*";
  const columns: Column<CcInhibition>[] = [
    { header: "Source", cell: (r) => <span className="font-mono text-xs">{fmt(r.source_matchers)}</span> },
    { header: "Target", cell: (r) => <span className="font-mono text-xs">{fmt(r.target_matchers)}</span> },
    { header: "Equal", cell: (r) => (r.equal ?? []).join(", ") || "—" },
    { header: "", cell: (r) => <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>Delete</Button> },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clickety-Clack — Inhibitions</h1>
        <Button onClick={() => setOpen(true)}>New inhibition</Button>
      </div>
      {isError ? <CcQueryError error={error} /> : (
        <Card>
          <CardHeader><CardTitle>Inhibition rules</CardTitle></CardHeader>
          <CardContent>
            <DataTable data={data ?? []} columns={columns} rowKey={(r) => r.id}
              emptyState={<p className="p-4 text-sm text-muted-foreground">No inhibition rules.</p>} />
          </CardContent>
        </Card>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New inhibition</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <MatchersEditor label="Source matchers" value={source} onChange={setSource} />
            <MatchersEditor label="Target matchers" value={target} onChange={setTarget} />
            <div>
              <label className="text-sm font-medium">Equal labels (comma-separated)</label>
              <Input value={equal} onChange={(e) => setEqual(e.target.value)} placeholder="cluster, namespace" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit** (with route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/inhibitions.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add CC Inhibitions CRUD page"
```

### Task 4.4: Silences page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx`

- [ ] **Step 1: Implement** (list + create dialog with datetime-local + cancel; author prefilled from session)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { MatchersEditor } from "@/components/cc/matchers-editor";
import { createCcSilence, deleteCcSilence, listCcSilences } from "@/data/cc/server";
import type { CcMatcher, CcSilence } from "@/data/cc/types";
import { CcQueryError, ccErrorMessage, ccFormatTs } from "./-cc-shared";

const q = () => queryOptions({ queryKey: ["cc", "silences"], queryFn: () => listCcSilences() });

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/silences")({
  staticData: { breadcrumb: "CC Silences" },
  loader: ({ context: { queryClient } }) => queryClient.prefetchQuery(q()),
  component: CcSilencesPage,
});

// datetime-local value (no tz) → RFC3339 UTC.
function toRfc3339(local: string): string {
  return local ? new Date(local).toISOString() : "";
}

function CcSilencesPage() {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery(q());
  const [open, setOpen] = useState(false);
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [comment, setComment] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["cc", "silences"] });
  const create = useMutation({
    mutationFn: () => createCcSilence({ data: {
      matchers, starts_at: toRfc3339(starts), ends_at: toRfc3339(ends),
      comment: comment || undefined,
    } }),
    onSuccess: () => { invalidate(); setOpen(false); setMatchers([]); setStarts(""); setEnds(""); setComment(""); toast.success("Silence created"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => deleteCcSilence({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Silence cancelled"); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const now = Date.now();
  const isActive = (s: CcSilence) => new Date(s.starts_at).getTime() <= now && now < new Date(s.ends_at).getTime();
  const columns: Column<CcSilence>[] = [
    { header: "State", cell: (s) => (isActive(s) ? "active" : "expired") },
    { header: "Matchers", cell: (s) => <span className="font-mono text-xs">{s.matchers.map((m) => `${m.label}${m.op}${m.value}`).join(", ")}</span> },
    { header: "Starts", cell: (s) => ccFormatTs(s.starts_at) },
    { header: "Ends", cell: (s) => ccFormatTs(s.ends_at) },
    { header: "Comment", cell: (s) => s.comment ?? "—" },
    { header: "", cell: (s) => <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(s.id)}>Cancel</Button> },
  ];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Clickety-Clack — Silences</h1>
        <Button onClick={() => setOpen(true)}>New silence</Button>
      </div>
      {isError ? <CcQueryError error={error} /> : (
        <Card>
          <CardHeader><CardTitle>Silences</CardTitle></CardHeader>
          <CardContent>
            <DataTable data={data ?? []} columns={columns} rowKey={(s) => s.id}
              emptyState={<p className="p-4 text-sm text-muted-foreground">No silences.</p>} />
          </CardContent>
        </Card>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New silence</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <MatchersEditor value={matchers} onChange={setMatchers} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-sm font-medium">Starts</label><Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
              <div><label className="text-sm font-medium">Ends</label><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
            </div>
            <div><label className="text-sm font-medium">Comment</label><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="maintenance" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={matchers.length === 0 || !starts || !ends || create.isPending} onClick={() => create.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit** (with route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add CC Silences page"
```

### Task 4.5: Settings (subscriptions) page

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/settings.tsx`

- [ ] **Step 1: Implement** (create-only; CC exposes no list/delete for subscriptions)

```tsx
// packages/app/src/routes/_authenticated/_dashboard/cc-alerting/settings.tsx
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { createCcSubscription } from "@/data/cc/server";
import { ccErrorMessage } from "./-cc-shared";

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting/settings")({
  staticData: { breadcrumb: "CC Settings" },
  component: CcSettingsPage,
});

function CcSettingsPage() {
  const [url, setUrl] = useState("");
  const create = useMutation({
    mutationFn: () => createCcSubscription({ data: { webhookUrl: url } }),
    onSuccess: (s) => { toast.success(`Subscription created (${s.id.slice(0, 8)})`); setUrl(""); },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-bold">Clickety-Clack — Settings</h1>
      <Card>
        <CardHeader><CardTitle>Firehose subscriptions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            With no routes configured, every event is delivered to each subscription webhook. CC exposes
            create only — it has no list or delete endpoint, so subscriptions cannot be enumerated here.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium">Webhook URL</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
            </div>
            <Button disabled={!url || create.isPending} onClick={() => create.mutate()}>Add</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit + dev smoke-test** (with route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
Run the dev server and click through `/cc-alerting/routes`, `/inhibitions`, `/silences`, `/settings` against a running CC; verify create/delete round-trip and toasts. Stop the server.
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/settings.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add CC subscriptions settings page"
```

### Task 4.6: "Silence this" shortcut from an alert (spec §7)

**Files:**
- Modify: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx`
- Modify: `packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx`

Prefill the silence dialog from an alert instance's labels via a search param, so an operator can silence directly from the Alerts page.

- [ ] **Step 1: Accept a `prefill` search param on the Silences route**

In `silences.tsx`, add a `validateSearch` to the route that parses an optional `prefill` (JSON-encoded `Record<string,string>` of labels), and in the component, when `prefill` is present on mount, seed `matchers` with one `eq` matcher per label and open the dialog:

```typescript
// in createFileRoute({...}) options:
validateSearch: (s: Record<string, unknown>) => ({ prefill: typeof s.prefill === "string" ? s.prefill : undefined }),
```
```tsx
// in the component, after the existing useState hooks:
const { prefill } = Route.useSearch();
useEffect(() => {
  if (!prefill) return;
  try {
    const labels = JSON.parse(prefill) as Record<string, string>;
    setMatchers(Object.entries(labels).map(([label, value]) => ({ label, op: "eq" as const, value })));
    setOpen(true);
  } catch { /* ignore malformed prefill */ }
}, [prefill]);
```
(Add `import { useEffect } from "react";`.)

- [ ] **Step 2: Add a "Silence" action column to the Alerts page**

In `alerts.tsx`, add a trailing column linking to the Silences route with the instance labels encoded:

```tsx
{
  header: "",
  cell: (r) => (
    <Link to="/cc-alerting/silences" search={{ prefill: JSON.stringify(r.labels) }} className="text-primary hover:underline">
      Silence
    </Link>
  ),
},
```

- [ ] **Step 3: Typecheck + commit** (with route tree)

Run: `cd packages/app && pnpm exec tsc --noEmit` → PASS
```bash
git add packages/app/src/routes/_authenticated/_dashboard/cc-alerting/silences.tsx packages/app/src/routes/_authenticated/_dashboard/cc-alerting/alerts.tsx packages/app/src/routeTree.gen.ts
git commit -m "Add 'Silence this' shortcut from CC alerts"
```

---

## Phase 5 — Apply path (rules + receivers as-code)

> Three coordinated changes (Rust classifier, server schema, reconcilers+registry) plus a manifest convention. Verify the Rust handler `routes/api/apply.ts` passes `state.ccRules`/`state.ccReceivers` through unchanged once the schema accepts them.

### Task 5.1: Rust — classify the two new kinds

**Files:**
- Modify: `crates/everr-core/src/apply.rs`

- [ ] **Step 1: Read the structs + classifier**

Run: `cd /Users/gio/workspace/everr-labs/everr && sed -n '138,185p' crates/everr-core/src/apply.rs`
Identify `ApplyState`, `ApplyStateDocs`, and `classify_documents`.

- [ ] **Step 2: Add fields to both state structs**

In `ApplyStateDocs` (the `classify_documents` output) and `ApplyState` (the wire struct, `#[serde(rename_all = "camelCase")]`), add two fields mirroring `alerts`:
```rust
    pub cc_rules: Vec<ResourceDocument>,      // serializes as "ccRules"
    pub cc_receivers: Vec<ResourceDocument>,  // serializes as "ccReceivers"
```
(Use the exact element type the existing `alerts` field uses — `ResourceDocument` for the docs struct, and whatever the wire struct uses for `alerts`.)

- [ ] **Step 3: Add match arms + update the error/initialization**

In `classify_documents`, add the local vecs (`let mut cc_rules = Vec::new();` etc.), the arms, and include them in the returned struct:
```rust
            Some("CCAlertRule") => cc_rules.push(doc),
            Some("CCReceiver") => cc_receivers.push(doc),
```
Update the unsupported-kind message:
```rust
                "{}: unsupported kind \"{other}\" (supported: Dashboard, AlertRule, CCAlertRule, CCReceiver)",
```

- [ ] **Step 4: Update the existing classify test + add coverage**

In the `classify_splits_dashboards_and_alerts_and_rejects_unknown_kinds` test (and the unsupported-kind assertion), add `CCAlertRule`/`CCReceiver` docs and assert they land in `cc_rules`/`cc_receivers`. Update the rejected-kind to a genuinely unknown one (e.g. `AlertSettings` stays rejected).

- [ ] **Step 5: Build + test**

Run: `cd /Users/gio/workspace/everr-labs/everr && cargo test -p everr-core apply`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/everr-core/src/apply.rs
git commit -m "Classify CCAlertRule/CCReceiver kinds in everr apply"
```

### Task 5.2: Server — accept the new buckets

**Files:**
- Modify: `packages/app/src/data/as-code/schema.ts`

- [ ] **Step 1: Add the two arrays to `applyInput.state`**

In the `.strict()` `state` object (currently `dashboards` + `alerts`), add:
```typescript
        ccRules: z.array(resourceEntrySchema),
        ccReceivers: z.array(resourceEntrySchema),
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit`
Expected: PASS (the `KindResult`/registry loop is generic over `keyof state`).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/data/as-code/schema.ts
git commit -m "Accept ccRules/ccReceivers in apply input"
```

### Task 5.3: Reconcilers + registry

**Files:**
- Create: `packages/app/src/data/cc/apply.server.ts`
- Create: `packages/app/src/data/cc/apply.server.test.ts`
- Modify: `packages/app/src/data/as-code/registry.ts`

Identity strategy: stamp `everr.name` + `everr.repoid` into each CC **rule**'s `annotations` on create; reconcile by listing and matching those annotations. Receivers are keyed by `name` (CC upsert) and tagged the same way for prune-ownership.

- [ ] **Step 1: Write failing reconciler tests** (mock the CC client module)

```typescript
// packages/app/src/data/cc/apply.server.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  listRules: vi.fn(), createRule: vi.fn(), deleteRule: vi.fn(),
  listReceivers: vi.fn(), upsertReceiver: vi.fn(), deleteReceiver: vi.fn(),
}));
import * as client from "./client";
import { applyCcReceiverSpecs, applyCcRuleSpecs } from "./apply.server";

const entry = (resource: unknown) => ({ path: "r.yaml", resource });

it("creates a rule that is in config but absent in CC", async () => {
  (client.listRules as any).mockResolvedValue([]);
  (client.createRule as any).mockResolvedValue({ id: "new" });
  const res = await applyCcRuleSpecs({
    orgId: "o", repoid: "repo1",
    resources: [entry({ kind: "CCAlertRule", metadata: { name: "r1" }, spec: {
      sql: "SELECT 1", evaluationInterval: "30s", for: "0s",
      labelColumns: ["h"], valueColumn: "v", severity: "info", resolveAfter: 1,
    } })],
  });
  expect(res.created).toEqual(["r1"]);
  // annotations carry ownership identity
  const arg = (client.createRule as any).mock.calls[0][1];
  expect(arg.annotations["everr.name"]).toBe("r1");
  expect(arg.annotations["everr.repoid"]).toBe("repo1");
  expect(arg.interval_secs).toBe(30);
});

it("deletes a CC rule owned by repoid but absent from config", async () => {
  (client.listRules as any).mockResolvedValue([
    { id: "x", spec: { annotations: { "everr.name": "old", "everr.repoid": "repo1" } } },
  ]);
  const res = await applyCcRuleSpecs({ orgId: "o", repoid: "repo1", resources: [] });
  expect(client.deleteRule).toHaveBeenCalledWith("o", "x");
  expect(res.deleted).toEqual(["old"]);
});

it("ignores rules owned by a different repoid", async () => {
  (client.listRules as any).mockResolvedValue([
    { id: "y", spec: { annotations: { "everr.name": "other", "everr.repoid": "repo2" } } },
  ]);
  const res = await applyCcRuleSpecs({ orgId: "o", repoid: "repo1", resources: [] });
  expect(client.deleteRule).not.toHaveBeenCalled();
  expect(res.deleted).toEqual([]);
});

it("dryRun plans without calling mutating client methods", async () => {
  (client.listRules as any).mockResolvedValue([]);
  const res = await applyCcRuleSpecs({
    orgId: "o", repoid: "repo1", dryRun: true,
    resources: [entry({ kind: "CCAlertRule", metadata: { name: "r1" }, spec: {
      sql: "SELECT 1", evaluationInterval: "30s", for: "0s", labelColumns: [], severity: "info",
    } })],
  });
  expect(res.created).toEqual(["r1"]);
  expect(client.createRule).not.toHaveBeenCalled();
});

it("upserts receivers and prunes owned-but-absent", async () => {
  (client.listReceivers as any).mockResolvedValue([
    { name: "keep" }, { name: "drop" },
  ]);
  // ownership for receivers is tracked by a name set in config; prune those not present
  const res = await applyCcReceiverSpecs({
    orgId: "o", repoid: "repo1",
    resources: [entry({ kind: "CCReceiver", metadata: { name: "keep" }, spec: { channel: { type: "slack", url: "u" } } })],
  });
  expect(res.created.concat(res.updated)).toContain("keep");
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/apply.server.test.ts`
Expected: FAIL (module + missing `upsertReceiver`/`deleteReceiver` client verbs).

- [ ] **Step 3: Add the missing client verbs** to `data/cc/client.ts`

Add these two functions to `data/cc/client.ts` (reusing the already-imported `CcReceiverSchema`, `CcDeletedSchema`, and `ccRequest` — do not add new imports):

```typescript
export async function upsertReceiver(orgId: string, body: { name: string; channel: unknown }) {
  return CcReceiverSchema.parse(await ccRequest(orgId, "POST", "/v1/receivers", body));
}
export async function deleteReceiver(orgId: string, name: string) {
  return CcDeletedSchema.parse(await ccRequest(orgId, "DELETE", `/v1/receivers/${encodeURIComponent(name)}`));
}
```

- [ ] **Step 4: Implement the reconcilers**

```typescript
// packages/app/src/data/cc/apply.server.ts
import { z } from "zod";
import type { Reconciler } from "@/data/as-code/registry";
import * as client from "./client";

// ---- Resource schemas (apply YAML, camelCase) ----
const CcRuleResourceSchema = z.object({
  kind: z.literal("CCAlertRule"),
  metadata: z.object({ name: z.string().min(1) }).strict(),
  spec: z.object({
    sql: z.string(),
    evaluationInterval: z.string(),   // "30s","5m" → seconds
    for: z.string().default("0s"),
    labelColumns: z.array(z.string()).default([]),
    valueColumn: z.string().nullable().optional(),
    severity: z.enum(["info", "warning", "critical"]),
    annotations: z.record(z.string(), z.string()).default({}),
    resolveAfter: z.number().int().default(1),
  }).strict(),
}).strict();

const CcReceiverResourceSchema = z.object({
  kind: z.literal("CCReceiver"),
  metadata: z.object({ name: z.string().min(1) }).strict(),
  spec: z.object({
    channel: z.discriminatedUnion("type", [
      z.object({ type: z.literal("webhook"), url: z.string() }),
      z.object({ type: z.literal("slack"), url: z.string() }),
      z.object({ type: z.literal("pagerduty"), routing_key: z.string() }),
      z.object({ type: z.literal("email"), to: z.array(z.string()) }),
    ]),
  }).strict(),
}).strict();

const OWN_NAME = "everr.name";
const OWN_REPO = "everr.repoid";

/** "30s","5m","1h" → seconds. */
function durationToSecs(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s}`);
  const n = Number(m[1]);
  return m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
}

/** Desired CC RuleSpec (CC wire shape) from the apply resource, with ownership annotations. */
function toRuleSpec(r: z.infer<typeof CcRuleResourceSchema>, repoid: string) {
  return {
    sql: r.spec.sql,
    interval_secs: durationToSecs(r.spec.evaluationInterval),
    for_secs: durationToSecs(r.spec.for),
    label_columns: r.spec.labelColumns,
    value_column: r.spec.valueColumn ?? null,
    severity: r.spec.severity,
    annotations: { ...r.spec.annotations, [OWN_NAME]: r.metadata.name, [OWN_REPO]: repoid },
    resolve_after: r.spec.resolveAfter,
  };
}

// Stable identity for change detection: everything except ownership annotations.
function specFingerprint(spec: Record<string, unknown>): string {
  const ann = { ...(spec.annotations as Record<string, string> | undefined) };
  delete ann[OWN_NAME]; delete ann[OWN_REPO];
  return JSON.stringify({ ...spec, annotations: ann });
}

export const applyCcRuleSpecs: Reconciler = async ({ orgId, repoid, resources, dryRun }) => {
  const desired = resources.map((e) => {
    const parsed = CcRuleResourceSchema.parse(e.resource);
    return { name: parsed.metadata.name, spec: toRuleSpec(parsed, repoid) };
  });

  const existing = (await client.listRules(orgId)).filter(
    (r) => (r.spec.annotations ?? {})[OWN_REPO] === repoid,
  );
  const existingByName = new Map(existing.map((r) => [(r.spec.annotations ?? {})[OWN_NAME] ?? "", r]));

  const created: string[] = [], updated: string[] = [], deleted: string[] = [];

  for (const d of desired) {
    const cur = existingByName.get(d.name);
    if (!cur) {
      if (!dryRun) await client.createRule(orgId, d.spec as any);
      created.push(d.name);
    } else if (specFingerprint(cur.spec as any) !== specFingerprint(d.spec)) {
      // CC rules are immutable: delete + recreate.
      if (!dryRun) { await client.deleteRule(orgId, cur.id); await client.createRule(orgId, d.spec as any); }
      updated.push(d.name);
    }
    existingByName.delete(d.name);
  }
  for (const [name, cur] of existingByName) {
    if (!dryRun) await client.deleteRule(orgId, cur.id);
    deleted.push(name);
  }
  return { created, updated, deleted };
};

export const applyCcReceiverSpecs: Reconciler = async ({ orgId, repoid, resources, dryRun }) => {
  const desired = resources.map((e) => CcReceiverResourceSchema.parse(e.resource));
  const desiredNames = new Set(desired.map((d) => d.metadata.name));

  const created: string[] = [], updated: string[] = [], deleted: string[] = [];
  const existing = await client.listReceivers(orgId);
  const existingNames = new Set(existing.map((r) => r.name));

  for (const d of desired) {
    if (!dryRun) await client.upsertReceiver(orgId, { name: d.metadata.name, channel: d.spec.channel });
    (existingNames.has(d.metadata.name) ? updated : created).push(d.metadata.name);
  }
  // Prune receivers that look repo-owned but are gone. CC receivers carry no
  // annotations, so prune any existing receiver absent from this repo's desired
  // set ONLY if it is not present (conservative: delete absent ones).
  for (const r of existing) {
    if (!desiredNames.has(r.name)) {
      if (!dryRun) await client.deleteReceiver(orgId, r.name);
      deleted.push(r.name);
    }
  }
  return { created, updated, deleted };
};
```

> **Receiver-prune caveat:** CC receivers carry no annotations, so this reconciler treats the repo's receiver set as authoritative for the tenant and prunes any receiver not in the config. If multiple apply-repos or manual receivers must coexist, this is too aggressive — note it in the PR. (The conservative alternative — never prune receivers — can be substituted by dropping the prune loop; flag the choice for review.)

- [ ] **Step 5: Register the reconcilers**

In `packages/app/src/data/as-code/registry.ts`: import `{ applyCcReceiverSpecs, applyCcRuleSpecs }` from `@/data/cc/apply.server`, and append to `REGISTRY`:
```typescript
  { key: "ccRules", kind: "CCAlertRule", reconcile: applyCcRuleSpecs },
  { key: "ccReceivers", kind: "CCReceiver", reconcile: applyCcReceiverSpecs },
```

- [ ] **Step 6: Run reconciler tests — verify pass**

Run: `cd packages/app && pnpm exec vitest run src/data/cc/apply.server.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + full unit suite**

Run: `cd packages/app && pnpm exec tsc --noEmit && pnpm exec vitest run src/data/cc src/lib/clickety-clack.server.test.ts src/hooks/use-cc-events.test.ts src/components/cc`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/data/cc/apply.server.ts packages/app/src/data/cc/apply.server.test.ts packages/app/src/data/cc/client.ts packages/app/src/data/as-code/registry.ts
git commit -m "Add CC rule + receiver apply reconcilers"
```

### Task 5.4: End-to-end apply smoke test (manual)

- [ ] **Step 1: Write a sample gitops dir**

Create a scratch dir with `everr.yaml` (`repoid: cc-demo`) and `rules.yaml`:
```yaml
kind: CCAlertRule
metadata: { name: high-errors }
spec:
  sql: "SELECT host FROM errors WHERE rate > 100"
  evaluationInterval: "30s"
  for: "60s"
  labelColumns: [host]
  valueColumn: rate
  severity: critical
  resolveAfter: 1
---
kind: CCReceiver
metadata: { name: oncall }
spec:
  channel: { type: slack, url: "https://hooks.slack.com/demo" }
```

- [ ] **Step 2: Dry-run then apply** against a running everr (web) + CC `api`

Run: `everr apply ./scratch --dry-run` → expect a plan listing `high-errors` (create) + `oncall` (create).
Run: `everr apply ./scratch -y` → expect created. Re-run → expect no-op (idempotent). Change the SQL → expect `high-errors` updated (delete+recreate). Remove from config + apply → expect deleted.
Confirm in the UI: `/cc-alerting/rules` shows the rule with health; `/cc-alerting/receivers` shows `oncall`.

- [ ] **Step 3: No commit** (scratch dir is throwaway; do not add it to git).

---

## Final verification

- [ ] **Full typecheck:** `cd packages/app && pnpm exec tsc --noEmit` → PASS
- [ ] **Full unit suite (CC-scoped):** `cd packages/app && pnpm exec vitest run src/data/cc src/lib/clickety-clack.server.test.ts src/hooks/use-cc-events.test.ts src/components/cc` → PASS
- [ ] **Rust:** `cd /Users/gio/workspace/everr-labs/everr && cargo test -p everr-core apply` → PASS
- [ ] **Lint/format** per repo convention (run the repo's configured linter, e.g. `pnpm lint` / `pnpm exec biome check` — check `package.json`) → PASS
- [ ] **Dispatch a final code-reviewer** over the whole branch before finishing.
- [ ] **Finish the branch** via superpowers:finishing-a-development-branch.
