# Gitops Dashboards — API Tokens (apply auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let CI authenticate `applyDashboards` non-interactively with an existing org-scoped `ingest` API key, so gitops apply works without a browser session.

**Architecture:** Reuse better-auth's existing `apiKey` plugin instead of building a token subsystem. A small resolver verifies a bearer key against an allow-list of configIds (just `ingest` for now) and resolves it to the key's organization. A new server-fn middleware tries the API key first and falls back to the interactive session, then `applyDashboards` uses it. No new auth config and no new UI.

**Tech Stack:** TypeScript, better-auth (apiKey plugin), TanStack Start server functions/middleware, Zod, Vitest.

**Scope note:** This is plan 2 of 3 (Core shipped; the Rust CLI is plan 3). Locked decision: **only the `ingest` (org-scoped) key now.** The allowed-configId set is kept as a list so a user-scoped `cli` key or a dedicated `deploy` key can be added later by appending one entry (the user-referenced case will also need an org-resolution branch at that time — explicitly deferred).

---

## Background (existing code this builds on)

- `packages/app/src/lib/auth.server.ts` configures the `apiKey` plugin; the relevant config is `{ configId: "ingest", references: "organization", defaultPrefix: "ek_", requireName: true, rateLimit: { enabled: false } }`.
- `packages/app/src/routes/api/internal/verify-key.ts` shows the verify call:
  `await auth.api.verifyApiKey({ body: { key, configId } })` → `result.valid`, `result.key.referenceId` (the org id for org-referenced keys), and `result.key.id`.
- `packages/app/src/lib/serverFn.ts` defines `authMiddleware` (calls `auth.api.getSession({ headers: request.headers })`), `requireOrgMiddleware` (asserts `activeOrganizationId`, builds `context.session` + `context.clickhouse` via `createClickhouseQuery`), and `createAuthenticatedServerFn = createServerFn().middleware([requireOrgMiddleware])`.
- `applyDashboards` (`packages/app/src/data/dashboards/server.ts`) currently uses `createAuthenticatedServerFn` and only reads `context.session.session.activeOrganizationId`.

---

## File Structure

**New files:**
- `packages/app/src/data/dashboards/apply-auth.ts` — bearer-key extraction + verify against allow-listed configIds → org id.
- `packages/app/src/data/dashboards/apply-auth.test.ts` — resolver unit tests.
- `packages/app/src/lib/serverFn.apply-auth.test.ts` — context-building unit test (Task 3).

**Modified files:**
- `packages/app/src/lib/serverFn.ts` — add `buildApplyContext`, `requireOrgOrApiKeyMiddleware`, `createApplyServerFn`.
- `packages/app/src/data/dashboards/server.ts` — `applyDashboards` uses `createApplyServerFn`.

**Unchanged:** auth.server.ts (no new config), all UI (`ingest` keys come from the existing Ingest Keys page).

---

## Task 1: Apply-auth resolver (ingest keys only)

Turns an incoming request's bearer key into the key's organization id, or returns null when there's no API key (so the caller falls back to session auth).

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

import { extractBearerKey, resolveApplyAuth } from "./apply-auth";

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("resolves an org-referenced ingest key to its org", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1" },
    });
    const result = await resolveApplyAuth(headers({ authorization: "Bearer ek_abc" }));
    expect(result).toEqual({ organizationId: "org-1", principalId: "apikey:k1" });
    expect(verifyApiKey).toHaveBeenCalledWith({ body: { key: "ek_abc", configId: "ingest" } });
  });

  it("resolves via the x-api-key header too", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k2", referenceId: "org-2" },
    });
    const result = await resolveApplyAuth(headers({ "x-api-key": "ek_def" }));
    expect(result).toEqual({ organizationId: "org-2", principalId: "apikey:k2" });
  });

  it("throws when the key is invalid", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: false, key: null });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer nope" })),
    ).rejects.toThrow(/invalid api key/i);
  });

  it("throws when a valid key has no referenceId", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: true, key: { id: "k3" } });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer ek_weird" })),
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
import { auth } from "@/lib/auth.server";

/**
 * API key configs accepted for `applyDashboards`, in priority order. Only the
 * org-referenced `ingest` key is accepted today. To add a user-referenced `cli`
 * key or a dedicated `deploy` key later, append an entry here — a user-referenced
 * config will also need an org-resolution branch in `resolveApplyAuth` (the
 * `references` field is the discriminator for that).
 */
const APPLY_KEY_CONFIGS: ReadonlyArray<{
  configId: string;
  references: "organization";
}> = [{ configId: "ingest", references: "organization" }];

export interface ApplyAuth {
  organizationId: string;
  /** Audit principal, e.g. "apikey:<keyId>". */
  principalId: string;
}

/** Pull an API key from `Authorization: Bearer <key>` or `x-api-key`. */
export function extractBearerKey(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

/**
 * Resolve apply auth from request headers. Returns null when no API key is
 * present (the caller should then fall back to interactive session auth).
 * Throws when a key IS present but invalid.
 */
export async function resolveApplyAuth(
  headers: Headers,
): Promise<ApplyAuth | null> {
  const key = extractBearerKey(headers);
  if (!key) return null;

  for (const config of APPLY_KEY_CONFIGS) {
    const result = await auth.api.verifyApiKey({
      body: { key, configId: config.configId },
    });
    if (!result.valid || !result.key?.referenceId) continue;
    // Only org-referenced configs are in the list today, so referenceId is the
    // organization id.
    return {
      organizationId: result.key.referenceId,
      principalId: `apikey:${result.key.id}`,
    };
  }

  throw new Error("Invalid API key");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/apply-auth.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck the new module**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "data/dashboards/apply-auth.ts" || echo "no apply-auth errors"`
Expected: "no apply-auth errors".

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/data/dashboards/apply-auth.ts packages/app/src/data/dashboards/apply-auth.test.ts
git commit -m "feat(dashboards): resolve apply auth from ingest api keys"
```

---

## Task 2: `buildApplyContext` + `requireOrgOrApiKey` middleware + `createApplyServerFn`

Wire the resolver into a server-fn middleware that prefers an API key and falls back to the session, then route `applyDashboards` through it. The context-building logic is extracted into a pure, framework-free function so it can be unit-tested in Task 3.

**Files:**
- Modify: `packages/app/src/lib/serverFn.ts`
- Modify: `packages/app/src/data/dashboards/server.ts`

- [ ] **Step 1: Read the current middleware**

Run: `cd packages/app && sed -n '1,60p' src/lib/serverFn.ts`
Confirm the shapes of `authMiddleware`, `requireOrgMiddleware`, and the `context` they build (`session.session.activeOrganizationId`, `session.user`, `clickhouse.query` via `createClickhouseQuery`). The new middleware mirrors that output context so downstream handlers are unchanged.

- [ ] **Step 2: Add `buildApplyContext` + middleware + factory to `serverFn.ts`**

Add the `resolveApplyAuth` import at the TOP of the file with the other imports, then append after the existing `createAuthenticatedServerFn` export:

```typescript
// at top of file, with the other imports:
// import { resolveApplyAuth, type ApplyAuth } from "@/data/dashboards/apply-auth";

/**
 * Build the org-scoped server-fn context from either a resolved API key or an
 * interactive session. Pure and framework-free so it can be unit-tested.
 * Throws when neither path yields an active organization.
 */
export function buildApplyContext(
  apiAuth: ApplyAuth | null,
  session: Awaited<ReturnType<typeof auth.api.getSession>>,
) {
  if (apiAuth) {
    return {
      session: {
        session: { activeOrganizationId: apiAuth.organizationId },
        user: { id: apiAuth.principalId },
      },
      clickhouse: { query: createClickhouseQuery(apiAuth.organizationId) },
    };
  }
  if (!session?.session || !session?.user) {
    throw new Error("Unauthenticated");
  }
  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) {
    throw new Error("No active organization");
  }
  return {
    session: {
      session: { ...session.session, activeOrganizationId: activeOrgId },
      user: session.user,
    },
    clickhouse: { query: createClickhouseQuery(activeOrgId) },
  };
}

/**
 * Authorize a dashboards apply: prefer an API key (CI/gitops), fall back to the
 * interactive session+org. Same context shape as requireOrgMiddleware.
 */
export const requireOrgOrApiKeyMiddleware = createMiddleware().server(
  async ({ request, next }) => {
    const apiAuth = await resolveApplyAuth(request.headers);
    const session = apiAuth
      ? null
      : await auth.api.getSession({ headers: request.headers });
    return next({ context: buildApplyContext(apiAuth, session) });
  },
);

export const createApplyServerFn = createServerFn().middleware([
  requireOrgOrApiKeyMiddleware,
]);
```

Notes:
- `createMiddleware`, `createServerFn`, `auth`, and `createClickhouseQuery` are already imported/used in this file — reuse them; only add the `resolveApplyAuth`/`ApplyAuth` import.
- `apply-auth.ts` imports only `auth.server` (not `serverFn`), so there is no import cycle.
- The API-key context sets a minimal `user: { id: principalId }`. `applyDashboards` only reads `activeOrganizationId`, so this is sufficient — do not fabricate other user fields.

- [ ] **Step 3: Route `applyDashboards` through the new factory**

In `packages/app/src/data/dashboards/server.ts`:
- Change `applyDashboards`'s definition from `createAuthenticatedServerFn({ method: "POST" })` to `createApplyServerFn({ method: "POST" })`.
- Add `createApplyServerFn` to the existing `import { createAuthenticatedServerFn } from "@/lib/serverFn"` (keep `createAuthenticatedServerFn` — the read fns still use it).

The handler body is unchanged — it already reads `context.session.session.activeOrganizationId`.

- [ ] **Step 4: Confirm existing apply tests still pass**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards/server.test.ts`
Expected: PASS. Existing `applyDashboards` tests call the handler directly with a `context` argument, so the middleware swap doesn't affect them.

- [ ] **Step 5: Typecheck**

Run: `cd packages/app && pnpm exec tsc --noEmit 2>&1 | rg "lib/serverFn.ts|data/dashboards/server.ts" || echo "no errors"`
Expected: "no errors".

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/serverFn.ts packages/app/src/data/dashboards/server.ts
git commit -m "feat(dashboards): accept ingest api-key auth for applyDashboards"
```

---

## Task 3: `buildApplyContext` unit test

Assert the context-selection logic (API key wins; session fallback; neither → throw) so the wiring can't silently break.

**Files:**
- Create: `packages/app/src/lib/serverFn.apply-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/lib/serverFn.apply-auth.test.ts
import { describe, expect, it, vi } from "vitest";

// buildApplyContext calls createClickhouseQuery(orgId); stub it so we don't
// touch the real clickhouse client.
vi.mock("./clickhouse", () => ({
  createClickhouseQuery: (orgId: string) => ({ __org: orgId }),
}));
// serverFn.ts imports auth.server transitively; stub to avoid booting it.
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/data/dashboards/apply-auth", () => ({
  resolveApplyAuth: vi.fn(),
}));

import { buildApplyContext } from "./serverFn";

describe("buildApplyContext", () => {
  it("uses the API-key org when apiAuth is present", () => {
    const ctx = buildApplyContext(
      { organizationId: "org-k", principalId: "apikey:1" },
      null,
    );
    expect(ctx.session.session.activeOrganizationId).toBe("org-k");
    expect(ctx.session.user.id).toBe("apikey:1");
  });

  it("falls back to the session org when apiAuth is null", () => {
    const ctx = buildApplyContext(null, {
      session: { activeOrganizationId: "org-s" },
      user: { id: "u1" },
    } as never);
    expect(ctx.session.session.activeOrganizationId).toBe("org-s");
  });

  it("throws when there is no apiAuth and no session", () => {
    expect(() => buildApplyContext(null, null)).toThrow(/unauthenticated/i);
  });

  it("throws when the session has no active organization", () => {
    expect(() =>
      buildApplyContext(null, { session: {}, user: { id: "u1" } } as never),
    ).toThrow(/no active organization/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/app && pnpm exec vitest run src/lib/serverFn.apply-auth.test.ts`
Expected: FAIL — `buildApplyContext` not yet exported (if Task 2 incomplete) or mock wiring needs adjustment.

- [ ] **Step 3: Make it pass**

If the test fails because importing `serverFn.ts` pulls in modules that crash under test (e.g. env validation in `auth.server` or `clickhouse`), add the minimal `vi.mock` for the offending module at the top of the test (the mocks above cover `clickhouse`, `auth.server`, and `apply-auth`; add others only if an import error names them). Do NOT change `serverFn.ts` to accommodate the test beyond the `buildApplyContext` export already added in Task 2.

Run: `cd packages/app && pnpm exec vitest run src/lib/serverFn.apply-auth.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 4: Full suite + typecheck**

Run: `cd packages/app && pnpm exec vitest run src/data/dashboards src/lib && pnpm exec tsc --noEmit 2>&1 | rg "serverFn|apply-auth|dashboards/server" || echo "clean"`
Expected: tests PASS; "clean".

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/serverFn.apply-auth.test.ts
git commit -m "test(dashboards): cover apply-context org selection"
```

---

## Task 4: Real smoke (ingest key authenticates apply) + docs

Confirm a real org-scoped ingest key authenticates `applyDashboards` against the running dev server, and document the env/header contract for the CLI (plan 3).

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md` (append an "Apply auth (implemented)" note).

- [ ] **Step 1: Discover how to call the apply server fn**

TanStack Start exposes server functions over HTTP. Find the URL/envelope: `cd packages/app && rg -n "applyDashboards" src/routeTree.gen.ts 2>/dev/null | head`, and inspect how the app posts a server fn in the browser network tab if reachable. If the server-fn HTTP envelope is unclear, use a Node-script fallback: import `resolveApplyAuth` and `buildApplyContext` and the `applyDashboards` handler, forge a `Headers` with the bearer key, and call the handler with the built context — proving the key→org→apply path end to end. Document which path you used.

- [ ] **Step 2: Mint an ingest key and call apply with it (dry run)**

Create an `ingest` key for the active org (Ingest Keys page → "New ingest key", or `authClient.apiKey.create({ configId: "ingest", organizationId, name: "gitops-smoke" })`). Copy the `ek_...` value. Then call apply with the key as a bearer token and `dryRun: true`:
```bash
curl -sS -X POST '<APPLY_SERVER_FN_URL>' \
  -H 'Authorization: Bearer ek_...' \
  -H 'Content-Type: application/json' \
  -d '{"source":"smoke","dryRun":true,"documents":[{"path":"cpu.yaml","document":{"kind":"Dashboard","metadata":{"name":"cpu"},"spec":{"panels":{},"layouts":[]}}}]}'
```
Expected: a JSON summary `{ created/updated/deleted, dryRun: true }` scoped to the key's org — NOT a 401/Unauthenticated. Adjust the body wrapper to match the app's server-fn envelope; if unclear, use the Node-script fallback from Step 1.

- [ ] **Step 3: Negative check**

Repeat with `Authorization: Bearer ek_totally_invalid`. Expected: an error (invalid API key), NOT a successful apply.

- [ ] **Step 4: Document the contract**

Append to the design spec a short "Apply auth (implemented in plan 2)" section: apply accepts `Authorization: Bearer <key>` (or `x-api-key`); the accepted key type today is the org-scoped `ingest` key; the CLI (plan 3) sends `EVERR_API_TOKEN` as this header; user-scoped `cli` keys and a dedicated `deploy` key are deferred (add by appending to `APPLY_KEY_CONFIGS`, with an org-resolution branch for user-referenced keys).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-gitops-dashboards-design.md
git commit -m "docs(dashboards): document apply ingest-key auth contract"
```

---

## Self-Review Notes (plan vs. locked decisions)

- **Ingest keys only, now:** `APPLY_KEY_CONFIGS` contains exactly `ingest` (org-referenced) — Task 1. No user-key/member lookup, no org-disambiguation header.
- **Extensible later:** the list + `references` discriminator are in place; adding `cli`/`deploy` is appending an entry (plus an org-resolution branch for user-referenced keys) — documented in code and in Task 4's note.
- **No new auth config / no new UI:** auth.server.ts and key-management screens untouched.
- **Non-interactive CI works:** the middleware prefers the key and never requires a session — Tasks 2–3, smoked in Task 4.
- **Session path preserved:** `buildApplyContext` falls back to `getSession` + active org — Task 2.
- **Testability:** context selection is a pure exported function (`buildApplyContext`), avoiding fragile middleware-internals testing — Task 3.
- **Deferred to plan 3:** the Rust CLI sending `EVERR_API_TOKEN`; this plan only makes the server accept the header.
