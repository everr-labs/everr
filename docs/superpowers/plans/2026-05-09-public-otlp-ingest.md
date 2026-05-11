# Public OTLP Ingest with API-Key Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the OTel collector to user-sent telemetry, with non-spoofable per-tenant API-key auth, rate limiting, key issuance UI, and SDK docs.

**Architecture:**
- Custom OTel collector **auth extension** (`everr_apikey`) validates `Authorization: Bearer <key>` against the existing better-auth `apikey` table via an internal HTTP endpoint in `packages/app`. The extension stamps `everr.tenant.id` into client metadata; an attributes processor upserts that into the resource and **overwrites any client-supplied value**.
- Public OTLP receiver (HTTP+gRPC) lives on its own pipeline, separate from the existing internal `githubactions` receiver pipeline so the trusted-header path is never reachable from outside.
- API keys are scoped to **organizations** (= tenants) using better-auth's native multi-config support: a second `apiKey` configuration with `configId: "ingest"` and `references: "organization"` runs alongside the existing user-scoped CLI config. Both share the `apikey` table; the existing `configId` column discriminates rows. No new column needed.
- Rate limiting uses existing `apikey.rateLimitMax` / `rateLimitTimeWindow` columns, enforced in the extension with an in-process LRU cache (~30s positive, ~5s negative).
- UI: admin-only "Ingest Keys" page in the dashboard for mint/list/revoke. Keys returned exactly once at creation.

**Tech Stack:** Go (collector, OTel v0.144/0.145, OCB-built), TanStack Start + React + shadcn (`@everr/ui`), better-auth `apiKey` plugin, Drizzle + Postgres, Vitest, testify.

---

## File Structure

**New files:**
- `collector/extension/everrapikeyauth/factory.go` — extension factory
- `collector/extension/everrapikeyauth/config.go` — `Endpoint`, `CacheTTL`, `NegativeCacheTTL`, `Timeout`
- `collector/extension/everrapikeyauth/extension.go` — Start/Shutdown, HTTP client to verify endpoint
- `collector/extension/everrapikeyauth/authenticator.go` — implements `extensionauth.Server.Authenticate`
- `collector/extension/everrapikeyauth/cache.go` — LRU with positive/negative TTL
- `collector/extension/everrapikeyauth/{factory,authenticator,cache}_test.go`
- `packages/app/src/routes/api/internal/verify-key.ts` — POST endpoint, header-shared-secret guarded
- `packages/app/src/routes/api/internal/verify-key.test.ts`
- `packages/app/src/routes/_authenticated/_dashboard/ingest-keys.tsx` — admin page
- `packages/app/src/components/ingest-keys/ingest-keys-table.tsx`
- `packages/app/src/components/ingest-keys/create-ingest-key-dialog.tsx`
- `packages/app/src/db/migrations/<n>_apikey_kind.sql` — adds `kind` column ("ingest" | "cli")
- `docs/sending-telemetry.md` — end-user SDK docs

**Modified files:**
- `collector/config/manifest.yaml` — add `everrapikeyauth` extension + standard `otlpreceiver`
- `collector/config/manifest.local.yaml` — same
- `collector/config.yml` — add public OTLP pipeline + auth extension wiring + tenant overwrite
- `collector/Makefile` — extension replace directive
- `packages/app/src/db/schema/auth.ts` — add `kind` column to `apikey`; switch `apikey.referenceId` semantics to organization id (no migration of existing rows — migrate by deleting all current keys; today no UI issues them)
- `packages/app/src/lib/auth.server.ts` — change `apiKey({ references: "user" })` to support both with `kind` discrimination; expose org-scoped key creation
- `packages/app/src/env.ts` — add `INGEST_VERIFY_SHARED_SECRET`

---

## Tasks

### Task 1: Schema — add `kind` column to `apikey`

**Files:**
- Modify: `packages/app/src/db/schema/auth.ts:152-183`

- [ ] **Step 1:** Add `kind: text("kind").default("cli").notNull()` to the `apikey` table after the existing `name` column. Values: `"cli"` (existing CLI keys) | `"ingest"` (collector ingest keys).
- [ ] **Step 2:** Per repo CLAUDE.md, **do not** run `drizzle-kit generate`. Instead, communicate the schema change so dev DB picks it up via `db:push` flow used in dev.
- [ ] **Step 3:** Run `pnpm -F app typecheck` — expect pass.
- [ ] **Step 4:** Commit: `feat(app): add kind column to apikey for ingest vs cli scoping`

---

### Task 2: Internal verify-key endpoint (TDD)

**Files:**
- Create: `packages/app/src/routes/api/internal/verify-key.ts`
- Create: `packages/app/src/routes/api/internal/verify-key.test.ts`
- Modify: `packages/app/src/env.ts` (add `INGEST_VERIFY_SHARED_SECRET: z.string().min(32)`)

**Behavior:** `POST /api/internal/verify-key` with header `x-internal-secret: <env>` and JSON body `{ key: string }`. Returns 200 `{ tenantId, keyId, rateLimit: { max, windowMs } }` on valid+enabled+unexpired ingest key, 401 otherwise. Returns 403 if shared secret mismatches.

- [ ] **Step 1: Write failing test** covering: missing secret → 403; bad key → 401; disabled key → 401; expired key → 401; non-ingest kind key → 401; valid ingest key → 200 with tenantId + rateLimit fields. Use the same `getHandler` pattern as `routes/api/cli/org.test.ts`.
- [ ] **Step 2:** Run test — expect FAIL (route doesn't exist).
- [ ] **Step 3: Implement.** Use `auth.api.verifyApiKey({ body: { key } })` from better-auth (server-side), then check `kind === "ingest"`, look up `referenceId` (org id), return shape above. On any failure, return 401 with no body. Use timing-safe comparison for the shared secret.
- [ ] **Step 4:** Run test — expect PASS.
- [ ] **Step 5:** Commit: `feat(app): internal verify-key endpoint for collector ingest auth`

---

### Task 3: better-auth apiKey plugin → org-scoped, with `kind` metadata

**Files:**
- Modify: `packages/app/src/lib/auth.server.ts:250-252`

- [ ] **Step 1:** Change apiKey plugin config so ingest keys are created with `referenceId = organizationId` and `kind = "ingest"`. CLI keys remain user-scoped (`kind = "cli"`).
- [ ] **Step 2:** Add server-side helper `createIngestKey({ orgId, name, userId })` and `revokeIngestKey({ keyId, orgId })` that enforce org admin membership.
- [ ] **Step 3:** Unit test the helpers with a fake auth context.
- [ ] **Step 4:** Run `pnpm -F app test` — expect PASS.
- [ ] **Step 5:** Commit: `feat(app): org-scoped ingest keys with kind discriminator`

---

### Task 4: Go auth extension — config + factory (TDD)

**Files:**
- Create: `collector/extension/everrapikeyauth/{factory,config}.go`
- Create: `collector/extension/everrapikeyauth/factory_test.go`
- Create: `collector/extension/everrapikeyauth/go.mod` (mirror `extension/sqlhttp/go.mod` minus chdb deps)

Pattern mirrors `collector/extension/sqlhttp/factory.go`.

`Config`:
```go
type Config struct {
    Endpoint         string        `mapstructure:"endpoint"`             // verify endpoint URL
    SharedSecret     configopaque.String `mapstructure:"shared_secret"`  // matches INGEST_VERIFY_SHARED_SECRET
    Timeout          time.Duration `mapstructure:"timeout"`              // default 2s
    CacheTTL         time.Duration `mapstructure:"cache_ttl"`            // default 30s
    NegativeCacheTTL time.Duration `mapstructure:"negative_cache_ttl"`   // default 5s
    CacheSize        int           `mapstructure:"cache_size"`           // default 10000
}
```

`factory.go`:
```go
func NewFactory() extension.Factory {
    return extension.NewFactory(
        component.MustNewType("everr_apikey"),
        createDefaultConfig,
        createExtension,
        component.StabilityLevelDevelopment,
    )
}
```

- [ ] **Step 1:** Write factory_test.go asserting default config + `Validate()` rejects empty Endpoint/SharedSecret.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement factory.go + config.go.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit: `feat(collector): scaffold everr_apikey auth extension`

---

### Task 5: Go auth extension — authenticator + cache (TDD)

**Files:**
- Create: `collector/extension/everrapikeyauth/authenticator.go`
- Create: `collector/extension/everrapikeyauth/cache.go`
- Create: `collector/extension/everrapikeyauth/extension.go`
- Create: `collector/extension/everrapikeyauth/{authenticator,cache}_test.go`

`extension.Extension` implements `extensionauth.Server`:

```go
func (e *ext) Authenticate(ctx context.Context, headers map[string][]string) (context.Context, error) {
    token := bearerFrom(headers)
    if token == "" { return ctx, errUnauthorized }
    res, err := e.lookup(ctx, token) // cache → HTTP verify
    if err != nil { return ctx, err }
    cl := client.FromContext(ctx)
    cl.Auth = authData{tenantID: res.TenantID, keyID: res.KeyID, rl: res.RateLimit}
    return client.NewContext(ctx, cl), nil
}
```

`authData` implements `client.AuthData` with `GetAttribute("tenant_id")` returning the org id as string. (Resource processor reads via `auth.tenant_id`.)

Cache: simple map+mutex with `expiresAt` per entry, sized by `CacheSize` (no eviction needed at this scale; LRU later if hot). Negative entries cached separately with shorter TTL.

Rate limit: per-key token bucket using `rateLimitMax` over `windowMs`. On exceed → return 429-equivalent error. The OTLP receiver translates auth errors to HTTP 401/gRPC Unauthenticated; rate-limit returns a distinct error type the receiver maps to 429 (use `extensionauth` error wrapping where supported; otherwise 401 is acceptable for v1 — document).

- [ ] **Step 1:** Write authenticator_test.go: missing header → err; bad token → err (calls verify, gets 401); good token → ctx has tenant_id; cache hit avoids second HTTP call; expired cache entry refetches; rate-limit exceeded → distinct error.
- [ ] **Step 2:** Write cache_test.go for TTL behavior + negative caching.
- [ ] **Step 3:** Run — FAIL.
- [ ] **Step 4:** Implement extension.go (HTTP client w/ timeout, JSON encoding, sets `x-internal-secret`), cache.go, authenticator.go.
- [ ] **Step 5:** Run — PASS.
- [ ] **Step 6:** Commit: `feat(collector): everr_apikey authenticator with caching + rate limit`

---

### Task 6: Wire extension into OCB manifest + go.mod replace

**Files:**
- Modify: `collector/config/manifest.yaml`
- Modify: `collector/config/manifest.local.yaml`
- Modify: `collector/Makefile` (if it has explicit replace lists; else manifests handle it)

- [ ] **Step 1:** Add to `extensions:` block:
  ```yaml
  - gomod: github.com/everr-labs/everr/collector/extension/everrapikeyauth v0.145.0
  ```
- [ ] **Step 2:** Add to `replaces:`:
  ```yaml
  - github.com/everr-labs/everr/collector/extension/everrapikeyauth => ../extension/everrapikeyauth
  ```
- [ ] **Step 3:** Add `otlpreceiver` to `receivers:` (OTel core OTLP receiver, used for the public endpoint):
  ```yaml
  - gomod: go.opentelemetry.io/collector/receiver/otlpreceiver v0.145.0
  ```
- [ ] **Step 4:** Run `make -C collector build` — expect success.
- [ ] **Step 5:** Commit: `chore(collector): register everr_apikey extension and otlpreceiver`

---

### Task 7: Update collector configs — public OTLP pipeline

**Files:**
- Modify: `collector/config.yml`

- [ ] **Step 1:** Add extension instance and OTLP receiver:
  ```yaml
  extensions:
    everr_apikey:
      endpoint: ${env:INGEST_VERIFY_URL}
      shared_secret: ${env:INGEST_VERIFY_SHARED_SECRET}

  receivers:
    githubactions: { ... existing ... }
    otlp/public:
      protocols:
        http:
          endpoint: 0.0.0.0:4318
          auth: { authenticator: everr_apikey }
        grpc:
          endpoint: 0.0.0.0:4317
          auth: { authenticator: everr_apikey }
  ```
- [ ] **Step 2:** Add tenant-overwrite processor (separate from the internal one used by the github pipeline):
  ```yaml
  processors:
    resource/public_tenant:
      attributes:
        - action: upsert
          key: everr.tenant.id
          from_context: auth.tenant_id
        - action: convert
          key: everr.tenant.id
          converted_type: int
    attributes/strip_user_tenant:
      include: { match_type: regexp, services: [".*"] }
      actions:
        - action: delete
          key: everr.tenant.id   # strip from spans/logs/metric attrs; resource processor restores from auth
  ```
- [ ] **Step 3:** Add three public pipelines (traces/metrics/logs) using `otlp/public` → `attributes/strip_user_tenant, resource/public_tenant, batch` → `clickhouse, debug`. Keep existing internal pipelines untouched.
- [ ] **Step 4:** Reference extension in `service.extensions: [everr_apikey]`.
- [ ] **Step 5:** Run `make -C collector run` against a local dev `INGEST_VERIFY_URL` — expect collector to start without errors.
- [ ] **Step 6:** Commit: `feat(collector): public OTLP pipeline gated by everr_apikey auth`

---

### Task 8: End-to-end smoke test

**Files:**
- Create: `collector/test/smoke/public_otlp_test.go`

- [ ] **Step 1:** Stand up a fake verify endpoint (httptest.Server) returning canned `{tenantId, keyId, rateLimit}` for a fixed key.
- [ ] **Step 2:** Boot collector with a temp config pointing at the fake verifier; OTLP receiver on a random port.
- [ ] **Step 3:** Send a span via OTLP HTTP without Authorization → expect 401.
- [ ] **Step 4:** Send a span with bogus Authorization → expect 401.
- [ ] **Step 5:** Send a span with valid bearer + a client-supplied `everr.tenant.id` resource attribute set to a different tenant → assert downstream pipeline saw `everr.tenant.id` equal to the verifier-returned tenantId (use a memory exporter / debug exporter capture).
- [ ] **Step 6:** Send 2× rateLimitMax requests within window → expect rate-limit failures.
- [ ] **Step 7:** Run — PASS. Commit: `test(collector): e2e smoke for public OTLP auth + tenant overwrite`

---

### Task 9: Ingest-keys UI — page scaffold + admin guard

**Files:**
- Create: `packages/app/src/routes/_authenticated/_dashboard/ingest-keys.tsx`
- Create: `packages/app/src/components/ingest-keys/ingest-keys-table.tsx`
- Create: `packages/app/src/components/ingest-keys/create-ingest-key-dialog.tsx`

Mirror `users-management.tsx` for admin-only redirect (`ensureOrgAdmin`).

- [ ] **Step 1:** Server fns: `listIngestKeys()` (returns id, name, prefix, createdAt, expiresAt, lastUsedAt-if-tracked, requestCount); `createIngestKey({ name, expiresInDays? })` returns the full key **once**; `revokeIngestKey({ id })`.
- [ ] **Step 2:** Page renders table + "Create" button. Dialog shows newly-minted key in a copy-once box with strong "you will not see this again" copy.
- [ ] **Step 3:** Test: handler tests for the three server fns (admin-only, org-scoped).
- [ ] **Step 4:** Manually verify in dev: create → key shown once → list shows prefix only → revoke removes from list.
- [ ] **Step 5:** Commit: `feat(app): ingest keys management UI`

---

### Task 10: SDK docs

**Files:**
- Create: `docs/sending-telemetry.md`

- [ ] **Step 1:** Document: how to mint a key (link to UI), endpoint URLs (HTTP `:4318`, gRPC `:4317`), required header (`Authorization: Bearer <key>`), example OTel SDK config snippets for Node, Python, Go (env-var form: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20...`).
- [ ] **Step 2:** Note: any `everr.tenant.id` resource attribute set client-side is ignored — tenant is determined by the key.
- [ ] **Step 3:** Commit: `docs: how to send telemetry to everr (public OTLP)`

---

## Self-Review Notes

- **Spec coverage:** every requirement from the design conversation has a task — auth extension (4–5), separate pipeline (7), tenant overwrite (7), rate limiting (5), UI (9), docs (10).
- **Type consistency:** `tenantId` is used uniformly across verify-endpoint response, extension auth data, and processor `auth.tenant_id`. `kind` field discriminates `cli`/`ingest` everywhere.
- **No placeholders:** code structure shown for new components; downstream tasks reference exact field names from upstream tasks.

## Risks / Open Items

- The OTel auth extension API around `extensionauth.Server` had churn between v0.140 and v0.145. Task 5 may need minor adjustments to the interface signature once we read the v0.145 source — verify in implementation.
- Mapping rate-limit-exceeded to HTTP 429 specifically (vs generic 401) depends on receiver behavior; v1 acceptable as 401 if needed, documented in task 5.
- Re-scoping `apikey.referenceId` from user → organization is breaking; we accept it because no UI mints keys today.
