# Gitops Dashboards — API Tokens (apply auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CI authenticate `applyDashboards` non-interactively with an existing org-scoped API key (and a personal user key), so gitops apply works without a browser session.

**Architecture:** Reuse better-auth's existing `apiKey` plugin instead of building a token subsystem. A small resolver verifies a bearer key against an allow-list of configIds and resolves it to a target organization (org-referenced keys → the key's org; user-referenced keys → the user's org via the `member` table). A new server-fn middleware tries the API key first and falls back to the interactive session, then `applyDashboards` uses it. No new auth config and no new UI.

**Tech Stack:** TypeScript, better-auth (apiKey plugin), TanStack Start server functions/middleware, Drizzle (Postgres), Zod, Vitest.

**Scope note:** This is plan 2 of 3 (Core shipped; the Rust CLI is plan 3). Decisions locked with the user: reuse the `ingest` (org-scoped) key now; also accept `cli` (user-scoped) keys; keep the allowed-configId set a list so a dedicated `deploy` key can be added later by appending one entry. No dedicated deploy config/UI in this plan.

---

## Background (existing code this builds on)

- `packages/app/src/lib/auth.server.ts` configures the `apiKey` plugin with two configs:
  `{ configId: "cli", references: "user", defaultPrefix: "cli_" }` and
  `{ configId: "ingest", references: "organization", defaultPrefix: "ek_", requireName: true, rateLimit: { enabled: false } }`.
- `packages/app/src/routes/api/internal/verify-key.ts` shows the verify call:
  `await auth.api.verifyApiKey({ body: { key, configId } })` → `result.valid` and `result.key.referenceId` (org id for org-referenced keys, user id for user-referenced keys) and `result.key.id`.
- `packages/app/src/lib/serverFn.ts` defines `authMiddleware` (calls `auth.api.getSession({ headers: request.headers })`), `requireOrgMiddleware` (asserts `activeOrganizationId`, builds `context.session` + `context.clickhouse`), and `createAuthenticatedServerFn = createServerFn().middleware([requireOrgMiddleware])`.
- `applyDashboards` (`packages/app/src/data/dashboards/server.ts`) currently uses `createAuthenticatedServerFn` and only reads `context.session.session.activeOrganizationId`.
- `member` table (`packages/app/src/db/schema/auth.ts`): `{ id, organizationId, userId, role, createdAt }`. Import as `member` from `@/db/schema`.

---

## File Structure

**New files:**
- `packages/app/src/data/dashboards/apply-auth.ts` — the resolver: bearer-key extraction + verify against allow-listed configIds + org resolution.
- `packages/app/src/data/dashboards/apply-auth.test.ts` — resolver unit tests.

**Modified files:**
- `packages/app/src/lib/serverFn.ts` — add `requireOrgOrApiKeyMiddleware` and `createApplyServerFn`.
- `packages/app/src/data/dashboards/server.ts` — `applyDashboards` uses `createApplyServerFn`.
- `packages/app/src/data/dashboards/server.test.ts` — keep existing apply tests working under the new factory (no behavior change for the session path).

**Unchanged:** auth.server.ts (no new config), all UI (no new key-management screens — `cli` keys come from the device-login flow; `ingest` keys from the existing Ingest Keys page).

---

## Task 1: Apply-auth resolver

A focused module that turns an incoming request's bearer key into a resolved organization id, or returns null when there's no API key (so the caller falls back to session auth).

**Files:**
- Create: `packages/app/src/data/dashboards/apply-auth.ts`
- Test: `packages/app/src/data/dashboards/apply-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/data/dashboards/apply-auth.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyApiKey = vi.fn();
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { verifyApiKey: (...args: unknown[]) => verifyApiKey(...args) } },
}));

// db.select().from().where() resolves to the member rows the test sets.
let memberRows: Array<{ organizationId: string }> = [];
vi.mock("@/db/client", () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(memberRows)),
  };
  return { db: { select: vi.fn(() => chain) } };
});
vi.mock("@/db/schema", () => ({
  member: { organizationId: "organization_id", userId: "user_id" },
}));

import { extractBearerKey, resolveApplyAuth } from "./apply-auth";

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

beforeEach(() => {
  vi.clearAllMocks();
  memberRows = [];
});

describe("extractBearerKey", () => {
  it("reads a Bearer token from the Authorization header", () => {
    expect(extractBearerKey(headers({ authorization: "Bearer ek_abc" }))).toBe("ek_abc");
  });
  it("reads the x-api-key header", () => {
    expect(extractBearerKey(headers({ "x-api-key": "ek_xyz" }))).toBe("ek_xyz");
  });
  it("returns null when no key header is present", () => {
    expect(extractBearerKey(headers({}))).toBeNull();
  });
});

describe("resolveApplyAuth", () => {
  it("returns null when there is no API key (caller falls back to session)", async () => {
    expect(await resolveApplyAuth(headers({}))).toBeNull();
  });

  it("resolves an org-referenced (ingest) key to its org", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1" },
    });
    const result = await resolveApplyAuth(headers({ authorization: "Bearer ek_abc" }));
    expect(result).toEqual({ organizationId: "org-1", principalId: "apikey:k1" });
    expect(verifyApiKey).toHaveBeenCalledWith({ body: { key: "ek_abc", configId: "ingest" } });
  });

  it("falls through to the user (cli) config and resolves the user's single org", async () => {
    // ingest verify fails, cli verify succeeds with a user referenceId.
    verifyApiKey
      .mockResolvedValueOnce({ valid: false, key: null })
      .mockResolvedValueOnce({ valid: true, key: { id: "k2", referenceId: "user-1" } });
    memberRows = [{ organizationId: "org-9" }];
    const result = await resolveApplyAuth(headers({ authorization: "Bearer cli_abc" }));
    expect(result).toEqual({ organizationId: "org-9", principalId: "apikey:k2" });
  });

  it("uses x-everr-organization-id to disambiguate a multi-org user key", async () => {
    verifyApiKey
      .mockResolvedValueOnce({ valid: false, key: null })
      .mockResolvedValueOnce({ valid: true, key: { id: "k3", referenceId: "user-2" } });
    memberRows = [{ organizationId: "org-a" }, { organizationId: "org-b" }];
    const result = await resolveApplyAuth(
      headers({ authorization: "Bearer cli_x", "x-everr-organization-id": "org-b" }),
    );
    expect(result).toEqual({ organizationId: "org-b", principalId: "apikey:k3" });
  });

  it("throws when a user key has multiple orgs and none is specified", async () => {
    verifyApiKey
      .mockResolvedValueOnce({ valid: false, key: null })
      .mockResolvedValueOnce({ valid: true, key: { id: "k4", referenceId: "user-3" } });
    memberRows = [{ organizationId: "org-a" }, { organizationId: "org-b" }];
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer cli_y" })),
    ).rejects.toThrow(/specify an organization/i);
  });

  it("throws when the key is invalid for every allowed config", async () => {
    verifyApiKey.mockResolvedValue({ valid: false, key: null });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer nope" })),
    ).rejects.toThrow(/invalid api key/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/apply-auth.test.ts`
Expected: FAIL — `apply-auth` module / exports missing.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/app/src/data/dashboards/apply-auth.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member } from "@/db/schema";
import { auth } from "@/lib/auth.server";

/**
 * API key configs accepted for `applyDashboards`, in priority order. Each entry
 * declares whether the key's `referenceId` is an organization or a user, which
 * decides how we resolve the target org. Append a `{ configId: "deploy",
 * references: "organization" }` here to add a dedicated deploy key later — no
 * other change required.
 */
const APPLY_KEY_CONFIGS: ReadonlyArray<{
  configId: string;
  references: "organization" | "user";
}> = [
  { configId: "ingest", references: "organization" },
  { configId: "cli", references: "user" },
];

export interface ApplyAuth {
  organizationId: string;
  /** Audit principal, e.g. "apikey:<keyId>". */
  principalId: string;
}

/** Pull an API key from `Authorization: Bearer <key>` or `x-api-key`. */
export function extractBearerKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

/** Resolve the org a user-referenced key should apply into. */
async function resolveUserOrg(
  userId: string,
  requestedOrgId: string | null,
): Promise<string> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));

  if (rows.length === 0) {
    throw new Error("API key user is not a member of any organization");
  }
  if (requestedOrgId) {
    const match = rows.find((r) => r.organizationId === requestedOrgId);
    if (!match) {
      throw new Error(
        "API key user is not a member of the requested organization",
      );
    }
    return match.organizationId;
  }
  if (rows.length > 1) {
    throw new Error(
      "API key user belongs to multiple organizations; specify an organization via the x-everr-organization-id header",
    );
  }
  // Non-null: length is exactly 1 here.
  return rows[0]!.organizationId;
}

/**
 * Resolve apply auth from request headers. Returns null when no API key is
 * present (the caller should then fall back to interactive session auth).
 * Throws when a key IS present but invalid or unresolvable to an org.
 */
export async function resolveApplyAuth(
  headers: Headers,
): Promise<ApplyAuth | null> {
  const key = extractBearerKey(headers);
  if (!key) return null;

  const requestedOrgId = headers.get("x-everr-organization-id");

  for (const config of APPLY_KEY_CONFIGS) {
    const result = await auth.api.verifyApiKey({
      body: { key, configId: config.configId },
    });
    if (!result.valid || !result.key?.referenceId) continue;

    const organizationId =
      config.references === "organization"
        ? result.key.referenceId
        : await resolveUserOrg(result.key.referenceId, requestedOrgId);

    return { organizationId, principalId: `apikey:${result.key.id}` };
  }

  throw new Error("Invalid API key");
}
```

Note on the `member` WHERE clause: the test asserts the query path; the resolver filters by `userId` only (the optional org match happens in JS). `and` is imported for parity with the codebase even though a single `eq` is used here — if your linter flags the unused import, drop `and` from the import. Keep `eq`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/apply-auth.test.ts`
Expected: PASS (all cases). If the unused `and` import fails lint/typecheck, remove it.

- [ ] **Step 5: Typecheck the new module**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "data/dashboards/apply-auth.ts" || echo "no apply-auth errors"`
Expected: "no apply-auth errors".

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/dashboards/apply-auth.ts packages/app/src/data/dashboards/apply-auth.test.ts
git commit -m "feat(dashboards): resolve apply auth from org/user api keys"
```

---

## Task 2: `requireOrgOrApiKey` middleware + `createApplyServerFn`

Wire the resolver into a server-fn middleware that prefers an API key and falls back to the session, then route `applyDashboards` through it.

**Files:**
- Modify: `packages/app/src/lib/serverFn.ts`
- Modify: `packages/app/src/data/dashboards/server.ts`

- [ ] **Step 1: Read the current middleware**

Run: `cd packages/app && sed -n '1,60p' src/lib/serverFn.ts`
Confirm the shapes of `authMiddleware`, `requireOrgMiddleware`, and the `context` they build (`session.session.activeOrganizationId`, `session.user`, `clickhouse.query`). The new middleware mirrors `requireOrgMiddleware`'s output context so downstream handlers are unchanged.

- [ ] **Step 2: Add the middleware + factory to `serverFn.ts`**

Append after the existing `createAuthenticatedServerFn` export. This imports the resolver and `createClickhouseQuery` (already imported in the file as `createClickhouseQuery` from `./clickhouse` — verify; the file already calls it in `requireOrgMiddleware`).

```typescript
// --- apply (gitops) auth: API key OR interactive session ---
import { resolveApplyAuth } from "@/data/dashboards/apply-auth";

/**
 * Authorize a dashboards apply: prefer an API key (CI/gitops) and fall back to
 * the interactive session+org. Produces the same context shape as
 * requireOrgMiddleware so handlers don't care which path authenticated them.
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const apiAuth = await resolveApplyAuth(request.headers);

    if (apiAuth) {
      return next({
        context: {
          session: {
            session: {
              activeOrganizationId: apiAuth.organizationId,
            },
            user: { id: apiAuth.principalId },
          },
          clickhouse: {
            query: createClickhouseQuery(apiAuth.organizationId),
          },
        },
      });
    }

    // No API key — fall back to interactive session + active org.
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.session || !session?.user) {
      throw new Error("Unauthenticated");
    }
    const activeOrgId = session.session.activeOrganizationId;
    if (!activeOrgId) {
      throw new Error("No active organization");
    }
    return next({
      context: {
        session: {
          session: { ...session.session, activeOrganizationId: activeOrgId },
          user: session.user,
        },
        clickhouse: { query: createClickhouseQuery(activeOrgId) },
      },
    });
  },
);

export const createApplyServerFn = createServerFn().middleware([
  requireOrgOrApiKeyMiddleware,
]);
```

Notes:
- Place the `import { resolveApplyAuth }` line with the other imports at the top of `serverFn.ts`, not mid-file (move it up). It's shown inline here only for context.
- `createMiddleware`, `createServerFn`, `auth`, and `createClickhouseQuery` are already imported/used in this file — reuse them.
- The API-key context sets a minimal `user: { id: principalId }` (no email/name). `applyDashboards` only reads `activeOrganizationId`, so this is sufficient; do not fabricate other user fields.

- [ ] **Step 3: Route `applyDashboards` through the new factory**

In `packages/app/src/data/dashboards/server.ts`:
- Change the `applyDashboards` definition from `createAuthenticatedServerFn({ method: "POST" })` to `createApplyServerFn({ method: "POST" })`.
- Update the import: add `createApplyServerFn` to the existing `import { createAuthenticatedServerFn } from "@/lib/serverFn"` (keep `createAuthenticatedServerFn` — `getDashboard`/`listDashboards`/`runPanelQuery`/`runVariableOptionsQuery` still use it).

The handler body is unchanged — it already reads `context.session.session.activeOrganizationId`.

- [ ] **Step 4: Confirm existing apply tests still pass (session path unchanged)**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS. The existing `applyDashboards` tests call the handler directly with a `context` argument, so the middleware swap doesn't affect them. If any test imported `createAuthenticatedServerFn`-specific typing that now mismatches, adjust the test's `context` object to match (it only needs `session.session.activeOrganizationId`).

- [ ] **Step 5: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "lib/serverFn.ts|data/dashboards/server.ts" || echo "no errors"`
Expected: "no errors". Watch for a circular-import warning between `serverFn.ts` and `apply-auth.ts` (apply-auth imports `auth.server` and `db`, not `serverFn`, so there is no cycle — but if tsc reports one, confirm apply-auth does NOT import from serverFn).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/serverFn.ts packages/app/src/data/dashboards/server.ts packages/app/src/data/dashboards/server.test.ts
git commit -m "feat(dashboards): accept api-key auth for applyDashboards"
```

---

## Task 3: Middleware integration test (api-key path end to end through the resolver)

Task 1 tested the resolver with mocks; this asserts the middleware actually grants/denies based on the resolver, so the wiring can't silently break.

**Files:**
- Create: `packages/app/src/lib/serverFn.apply-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/lib/serverFn.apply-auth.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveApplyAuth = vi.fn();
vi.mock("@/data/dashboards/apply-auth", () => ({
  resolveApplyAuth: (...a: unknown[]) => resolveApplyAuth(...a),
}));

const getSession = vi.fn();
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));

vi.mock("./clickhouse", () => ({
  createClickhouseQuery: (orgId: string) => ({ __org: orgId }),
}));

import { requireOrgOrApiKeyMiddleware } from "./serverFn";

// Invoke the middleware's server fn directly, capturing what it passes to next().
async function run(headers: Headers) {
  let captured: unknown;
  const next = vi.fn((arg: unknown) => {
    captured = arg;
    return arg;
  });
  // @ts-expect-error — exercising the middleware's server handler in isolation
  await requireOrgOrApiKeyMiddleware.options.server({
    request: { headers },
    next,
  });
  return captured as { context: { session: { session: { activeOrganizationId: string } } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireOrgOrApiKeyMiddleware", () => {
  it("uses the API-key org when the resolver returns one", async () => {
    resolveApplyAuth.mockResolvedValueOnce({ organizationId: "org-k", principalId: "apikey:1" });
    const out = await run(new Headers({ authorization: "Bearer ek_x" }));
    expect(out.context.session.session.activeOrganizationId).toBe("org-k");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls back to the session org when there is no API key", async () => {
    resolveApplyAuth.mockResolvedValueOnce(null);
    getSession.mockResolvedValueOnce({
      session: { activeOrganizationId: "org-s" },
      user: { id: "u1" },
    });
    const out = await run(new Headers({}));
    expect(out.context.session.session.activeOrganizationId).toBe("org-s");
  });

  it("throws when no API key and no session", async () => {
    resolveApplyAuth.mockResolvedValueOnce(null);
    getSession.mockResolvedValueOnce(null);
    await expect(run(new Headers({}))).rejects.toThrow(/unauthenticated/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails (or reveals the real shape)**

Run: `cd packages/app && pnpm exec vitest run src/lib/serverFn.apply-auth.test.ts`
Expected: FAIL initially. The `requireOrgOrApiKeyMiddleware.options.server` access is the likely friction point — TanStack's `createMiddleware().server(fn)` may not expose the handler as `.options.server`.

- [ ] **Step 3: Adjust the test to the real middleware handle**

Inspect how to reach the server handler: `cd packages/app && pnpm exec node -e "const m=require('@tanstack/react-start'); console.log(Object.keys(m))"` is unlikely to help (ESM); instead read an existing middleware usage/test in the repo: `rg -n "createMiddleware\(\)\.server|\.options\.|middleware\(\[" packages/app/src | head`. If the repo has no precedent for unit-invoking a middleware, change this test to exercise the resolver-to-context mapping through a thin exported helper instead: extract the context-building logic into an exported pure function `buildApplyContext(apiAuth, session)` in `serverFn.ts` and unit-test THAT (it has no framework coupling). Update Task 2's middleware to call `buildApplyContext`. Implement whichever path is real; do not leave the test asserting an API that doesn't exist.

- [ ] **Step 4: Make it pass**

Run: `cd packages/app && pnpm exec vitest run src/lib/serverFn.apply-auth.test.ts`
Expected: PASS. (If you extracted `buildApplyContext`, the test imports and calls it directly with the three scenarios: api-auth present → org-k; session present → org-s; neither → throws.)

- [ ] **Step 5: Full suite + typecheck**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards src/lib && pnpm exec tsc --noEmit 2>&1 | rg "serverFn|apply-auth|dashboards/server" || echo "clean"`
Expected: tests PASS; "clean".

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/serverFn.apply-auth.test.ts packages/app/src/lib/serverFn.ts
git commit -m "test(dashboards): cover apply-auth middleware org selection"
```

---

## Task 4: Real smoke (ingest key authenticates apply) + docs

Confirm a real org-scoped ingest key authenticates `applyDashboards` against the running dev server, and document the env/header contract for the CLI (plan 3).

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md` (append an "Apply auth (implemented)" note).

- [ ] **Step 1: Discover the apply server-fn endpoint URL**

TanStack Start exposes server functions over HTTP. Find the route/id `applyDashboards` resolves to: `cd packages/app && rg -n "applyDashboards" src/routeTree.gen.ts src/**/*.gen.* 2>/dev/null | head` and/or inspect a network call in the running app. If the server-fn URL is not easily discoverable, SKIP the live curl and instead do Step 2 via a Node script that imports and calls the handler with a forged Headers object through the middleware. Document which path you used.

- [ ] **Step 2: Mint an ingest key and call apply with it**

Using the running dev server on :5173 (already authenticated in the browser) OR the better-auth API, create an `ingest` key for the active org (the Ingest Keys page → "New ingest key", or `authClient.apiKey.create({ configId: "ingest", organizationId, name: "gitops-smoke" })`). Copy the `ek_...` value.

Then call the apply endpoint with the key as a bearer token and a dry run:
```bash
curl -sS -X POST '<APPLY_SERVER_FN_URL>' \
  -H 'Authorization: Bearer ek_...' \
  -H 'Content-Type: application/json' \
  -d '{"source":"smoke","dryRun":true,"documents":[{"path":"cpu.yaml","document":{"kind":"Dashboard","metadata":{"name":"cpu"},"spec":{"panels":{},"layouts":[]}}}]}'
```
Expected: a JSON summary `{ created/updated/deleted, dryRun: true }` scoped to the key's org — NOT a 401/Unauthenticated. (Exact request envelope may differ for TanStack server fns; adjust the body wrapper to match how the app posts server-fn args. If the envelope is unclear, use the Node-script fallback from Step 1.)

- [ ] **Step 3: Negative check**

Repeat the call with `Authorization: Bearer ek_totally_invalid`. Expected: an error (invalid API key / unauthenticated), NOT a successful apply.

- [ ] **Step 4: Document the contract**

Append to the design spec a short "Apply auth (implemented in plan 2)" section stating: apply accepts an `Authorization: Bearer <key>` (or `x-api-key`) header; allowed key types are org-scoped `ingest` keys and user-scoped `cli` keys; a user key with multiple orgs must set `x-everr-organization-id`; a dedicated `deploy` configId can be added later by appending to `APPLY_KEY_CONFIGS`. Note the CLI (plan 3) will send `EVERR_API_TOKEN` as this bearer header.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md
git commit -m "docs(dashboards): document apply api-key auth contract"
```

---

## Self-Review Notes (plan vs. locked decisions)

- **Reuse ingest keys now:** `APPLY_KEY_CONFIGS` includes `ingest` (org-referenced) first — Task 1.
- **Accept personal user keys:** `cli` (user-referenced) is in the list; org resolved via `member` with single-org and `x-everr-organization-id` disambiguation — Task 1.
- **Extensible to a dedicated deploy key later:** documented and structural — appending one `{ configId: "deploy", references: "organization" }` entry suffices. No re-architecting.
- **No new auth config / no new UI:** confirmed — auth.server.ts and key-management screens untouched.
- **Non-interactive CI works:** the middleware prefers the key and never requires a session — Tasks 2–3, smoked in Task 4.
- **Session path preserved:** fallback to `getSession` + active org keeps interactive behavior — Task 2.
- **Deferred to plan 3:** the Rust CLI that sends `EVERR_API_TOKEN`; this plan only makes the server accept the header.
