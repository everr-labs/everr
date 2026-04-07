# Onboarding via install.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `install.sh` → `everr onboarding` to handle the full new-user flow (org setup, GitHub App install, repo import) from the terminal, and add an `everr init` per-repo command.

**Architecture:** Four new CLI REST endpoints under `/api/cli/` handle org info/rename, repos listing, and NDJSON-streamed backfill. The `/cli/device` browser page is extended to auto-create orgs and prompt GitHub App install for new users. Two Rust commands — a renamed/expanded `everr onboarding` and a new `everr init` — orchestrate the terminal side using these endpoints.

**Tech Stack:** TypeScript + Vitest (server routes), Rust + tokio + reqwest + cliclack (CLI), WorkOS SDK, TanStack Start server routes.

---

## File Map

**Create (server):**
- `packages/app/src/routes/api/cli/org.ts` — GET /api/cli/org
- `packages/app/src/routes/api/cli/org.test.ts`
- `packages/app/src/routes/api/cli/org/name.ts` — PATCH /api/cli/org/name
- `packages/app/src/routes/api/cli/org/name.test.ts`
- `packages/app/src/routes/api/cli/repos.ts` — GET /api/cli/repos
- `packages/app/src/routes/api/cli/repos.test.ts`
- `packages/app/src/routes/api/cli/import.ts` — POST /api/cli/import (NDJSON stream)
- `packages/app/src/routes/api/cli/import.test.ts`

**Modify (server):**
- `packages/app/src/routes/cli/device.tsx` — new-user flow (org setup + GitHub App + auto-approve)
- `packages/app/src/data/onboarding.ts` — add `ensureOrganizationForDevice` server function

**Create (Rust):**
- `packages/desktop-app/src-cli/src/onboarding.rs` — full `everr onboarding` implementation
- `packages/desktop-app/src-cli/src/init.rs` — `everr init` implementation

**Modify (Rust):**
- `crates/everr-core/src/assistant.rs` — add `init_repo_instructions_auto`
- `crates/everr-core/src/api.rs` — add `OrgResponse`, `RepoEntry`, `ImportEvent` types + four `ApiClient` methods
- `packages/desktop-app/src-cli/src/cli.rs` — add `Init` variant, rename `Setup` → `Onboarding`
- `packages/desktop-app/src-cli/src/main.rs` — route new commands, delete `setup.rs` module
- `packages/desktop-app/src-cli/src/setup.rs` — delete (contents moved to `onboarding.rs`)

---

## Task 1: GET /api/cli/org

**Files:**
- Create: `packages/app/src/routes/api/cli/org.ts`
- Create: `packages/app/src/routes/api/cli/org.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/routes/api/cli/org.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    organizations: {
      getOrganization: vi.fn(),
    },
    userManagement: {
      listOrganizationMemberships: vi.fn(),
    },
  },
}));

import { workOS } from "@/lib/workos";
import { Route } from "./org";

const mockedGetOrg = vi.mocked(workOS.organizations.getOrganization);
const mockedListMemberships = vi.mocked(
  workOS.userManagement.listOrganizationMemberships,
);

type GetHandler = (args: {
  request: Request;
  context: { session: { userId: string; organizationId: string; tenantId: number } };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/org.");
  return handler;
}

const context = {
  session: { userId: "user_abc", organizationId: "org_xyz", tenantId: 1 },
};

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/org", () => {
  it("returns org name and isOnlyAdmin true when user is sole admin", async () => {
    mockedGetOrg.mockResolvedValueOnce({ name: "Acme Inc." } as Awaited<
      ReturnType<typeof mockedGetOrg>
    >);
    mockedListMemberships.mockResolvedValueOnce({
      data: [{ userId: "user_abc", role: { slug: "admin" } }],
    } as Awaited<ReturnType<typeof mockedListMemberships>>);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "Acme Inc.",
      isOnlyAdmin: true,
    });
    expect(mockedGetOrg).toHaveBeenCalledWith("org_xyz");
    expect(mockedListMemberships).toHaveBeenCalledWith({
      organizationId: "org_xyz",
    });
  });

  it("returns isOnlyAdmin false when another admin exists", async () => {
    mockedGetOrg.mockResolvedValueOnce({ name: "Acme Inc." } as Awaited<
      ReturnType<typeof mockedGetOrg>
    >);
    mockedListMemberships.mockResolvedValueOnce({
      data: [
        { userId: "user_abc", role: { slug: "admin" } },
        { userId: "user_def", role: { slug: "admin" } },
      ],
    } as Awaited<ReturnType<typeof mockedListMemberships>>);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ isOnlyAdmin: false });
  });

  it("returns isOnlyAdmin false when current user is not an admin", async () => {
    mockedGetOrg.mockResolvedValueOnce({ name: "Acme Inc." } as Awaited<
      ReturnType<typeof mockedGetOrg>
    >);
    mockedListMemberships.mockResolvedValueOnce({
      data: [{ userId: "user_abc", role: { slug: "member" } }],
    } as Awaited<ReturnType<typeof mockedListMemberships>>);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org"),
      context,
    });

    expect(await response.json()).toMatchObject({ isOnlyAdmin: false });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/app && pnpm test src/routes/api/cli/org.test.ts
```

Expected: FAIL — "Missing GET handler" or module not found.

- [ ] **Step 3: Implement the route**

```typescript
// packages/app/src/routes/api/cli/org.ts
import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

export const Route = createFileRoute("/api/cli/org")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const { organizationId, userId } = context.session;

        const [org, memberships] = await Promise.all([
          workOS.organizations.getOrganization(organizationId),
          workOS.userManagement.listOrganizationMemberships({ organizationId }),
        ]);

        const adminMembers = memberships.data.filter(
          (m) => m.role?.slug === "admin",
        );
        const isOnlyAdmin =
          adminMembers.length === 1 && adminMembers[0].userId === userId;

        return Response.json({ name: org.name, isOnlyAdmin });
      },
    },
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd packages/app && pnpm test src/routes/api/cli/org.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/org.ts packages/app/src/routes/api/cli/org.test.ts
git commit -m "feat: add GET /api/cli/org endpoint"
```

---

## Task 2: PATCH /api/cli/org/name

**Files:**
- Create: `packages/app/src/routes/api/cli/org/name.ts`
- Create: `packages/app/src/routes/api/cli/org/name.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/routes/api/cli/org/name.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/lib/workos", () => ({
  workOS: {
    organizations: {
      updateOrganization: vi.fn(),
    },
  },
}));

import { workOS } from "@/lib/workos";
import { Route } from "./name";

const mockedUpdateOrg = vi.mocked(workOS.organizations.updateOrganization);

type PatchHandler = (args: {
  request: Request;
  context: { session: { organizationId: string; tenantId: number } };
}) => Promise<Response>;

function getHandler(): PatchHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { PATCH?: PatchHandler } };
  };
  const handler = routeOptions.server?.handlers?.PATCH;
  if (!handler) throw new Error("Missing PATCH handler for /api/cli/org/name.");
  return handler;
}

const context = { session: { organizationId: "org_xyz", tenantId: 1 } };

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/org/name", () => {
  it("updates org name and returns ok", async () => {
    mockedUpdateOrg.mockResolvedValueOnce({} as Awaited<
      ReturnType<typeof mockedUpdateOrg>
    >);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "New Name" }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockedUpdateOrg).toHaveBeenCalledWith({
      organization: "org_xyz",
      name: "New Name",
    });
  });

  it("returns 400 when name is missing", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
    expect(mockedUpdateOrg).not.toHaveBeenCalled();
  });

  it("returns 400 when name is empty string", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/org/name", {
        method: "PATCH",
        body: JSON.stringify({ name: "" }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/app && pnpm test src/routes/api/cli/org/name.test.ts
```

- [ ] **Step 3: Implement the route**

```typescript
// packages/app/src/routes/api/cli/org/name.ts
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

const BodySchema = z.object({ name: z.string().min(1) });

export const Route = createFileRoute("/api/cli/org/name")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      PATCH: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "name is required" }, { status: 400 });
        }

        await workOS.organizations.updateOrganization({
          organization: context.session.organizationId,
          name: parsed.data.name,
        });

        return Response.json({ ok: true });
      },
    },
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd packages/app && pnpm test src/routes/api/cli/org/name.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/org/name.ts packages/app/src/routes/api/cli/org/name.test.ts
git commit -m "feat: add PATCH /api/cli/org/name endpoint"
```

---

## Task 3: GET /api/cli/repos

**Files:**
- Create: `packages/app/src/routes/api/cli/repos.ts`
- Create: `packages/app/src/routes/api/cli/repos.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/routes/api/cli/repos.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/data/tenants", () => ({
  getGithubInstallationsForTenant: vi.fn(),
}));

vi.mock("@/server/github-events/backfill", () => ({
  listInstallationRepos: vi.fn(),
}));

import { getGithubInstallationsForTenant } from "@/data/tenants";
import { listInstallationRepos } from "@/server/github-events/backfill";
import { Route } from "./repos";

const mockedGetInstallations = vi.mocked(getGithubInstallationsForTenant);
const mockedListRepos = vi.mocked(listInstallationRepos);

type GetHandler = (args: {
  request: Request;
  context: { session: { tenantId: number } };
}) => Promise<Response>;

function getHandler(): GetHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/repos.");
  return handler;
}

const context = { session: { tenantId: 42 } };

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/repos", () => {
  it("returns empty array when no active installation exists", async () => {
    mockedGetInstallations.mockResolvedValueOnce([
      { status: "uninstalled", installationId: 1 } as Awaited<
        ReturnType<typeof mockedGetInstallations>
      >[number],
    ]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedListRepos).not.toHaveBeenCalled();
  });

  it("returns repos from active installation", async () => {
    mockedGetInstallations.mockResolvedValueOnce([
      { status: "active", installationId: 99 } as Awaited<
        ReturnType<typeof mockedGetInstallations>
      >[number],
    ]);
    mockedListRepos.mockResolvedValueOnce([
      { id: 1, full_name: "acme/api" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
      { id: 2, full_name: "acme/web" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
    ]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 1, fullName: "acme/api" },
      { id: 2, fullName: "acme/web" },
    ]);
    expect(mockedListRepos).toHaveBeenCalledWith(99);
  });

  it("returns empty array when tenant has no installations", async () => {
    mockedGetInstallations.mockResolvedValueOnce([]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(await response.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/app && pnpm test src/routes/api/cli/repos.test.ts
```

- [ ] **Step 3: Implement the route**

```typescript
// packages/app/src/routes/api/cli/repos.ts
import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { getGithubInstallationsForTenant } from "@/data/tenants";
import { listInstallationRepos } from "@/server/github-events/backfill";

export const Route = createFileRoute("/api/cli/repos")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const installations = await getGithubInstallationsForTenant(
          context.session.tenantId,
        );
        const active = installations.find((i) => i.status === "active");

        if (!active) {
          return Response.json([]);
        }

        const repos = await listInstallationRepos(active.installationId);
        return Response.json(
          repos.map((r) => ({ id: r.id, fullName: r.full_name })),
        );
      },
    },
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd packages/app && pnpm test src/routes/api/cli/repos.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/repos.ts packages/app/src/routes/api/cli/repos.test.ts
git commit -m "feat: add GET /api/cli/repos endpoint"
```

---

## Task 4: POST /api/cli/import

**Files:**
- Create: `packages/app/src/routes/api/cli/import.ts`
- Create: `packages/app/src/routes/api/cli/import.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/routes/api/cli/import.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accessTokenAuthMiddleware", () => ({
  accessTokenAuthMiddleware: { options: {} },
}));

vi.mock("@/data/tenants", () => ({
  getGithubInstallationsForTenant: vi.fn(),
}));

vi.mock("@/server/github-events/backfill", () => ({
  listInstallationRepos: vi.fn(),
  backfillRepo: vi.fn(),
}));

import { getGithubInstallationsForTenant } from "@/data/tenants";
import { listInstallationRepos, backfillRepo } from "@/server/github-events/backfill";
import { Route } from "./import";

const mockedGetInstallations = vi.mocked(getGithubInstallationsForTenant);
const mockedListRepos = vi.mocked(listInstallationRepos);
const mockedBackfillRepo = vi.mocked(backfillRepo);

type PostHandler = (args: {
  request: Request;
  context: { session: { tenantId: number } };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for /api/cli/import.");
  return handler;
}

const context = { session: { tenantId: 42 } };

async function readNdjson(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/import", () => {
  it("returns 400 when repos list is empty", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/import", {
        method: "POST",
        body: JSON.stringify({ repos: [] }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when no active GitHub installation", async () => {
    mockedGetInstallations.mockResolvedValueOnce([]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/import", {
        method: "POST",
        body: JSON.stringify({ repos: ["acme/api"] }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
  });

  it("streams NDJSON progress and a done event", async () => {
    mockedGetInstallations.mockResolvedValueOnce([
      { status: "active", installationId: 99 } as Awaited<
        ReturnType<typeof mockedGetInstallations>
      >[number],
    ]);
    mockedListRepos.mockResolvedValueOnce([
      { id: 1, full_name: "acme/api" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
    ]);

    async function* fakeBackfill() {
      yield { status: "importing" as const, jobsEnqueued: 5, jobsQuota: 100, runsProcessed: 2 };
      yield { status: "done" as const, jobsEnqueued: 5, jobsQuota: 100, runsProcessed: 2, errors: [] };
    }
    mockedBackfillRepo.mockReturnValueOnce(fakeBackfill());

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/import", {
        method: "POST",
        body: JSON.stringify({ repos: ["acme/api"] }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await readNdjson(response);
    expect(events[0]).toMatchObject({ type: "repo-start", repoFullName: "acme/api" });
    expect(events).toContainEqual(expect.objectContaining({ type: "done" }));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/app && pnpm test src/routes/api/cli/import.test.ts
```

- [ ] **Step 3: Implement the route**

```typescript
// packages/app/src/routes/api/cli/import.ts
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { getGithubInstallationsForTenant } from "@/data/tenants";
import {
  backfillRepo,
  JOB_QUOTA_PER_REPO,
  listInstallationRepos,
} from "@/server/github-events/backfill";

const BodySchema = z.object({ repos: z.array(z.string().min(1)).min(1) });

export const Route = createFileRoute("/api/cli/import")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      POST: async ({ request, context }) => {
        const parsed = BodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "repos must be a non-empty array" }, { status: 400 });
        }

        const installations = await getGithubInstallationsForTenant(
          context.session.tenantId,
        );
        const active = installations.find((i) => i.status === "active");
        if (!active) {
          return Response.json({ error: "no active GitHub installation" }, { status: 400 });
        }

        const allRepos = await listInstallationRepos(active.installationId);
        const repos = parsed.data.repos
          .map((name) => allRepos.find((r) => r.full_name === name))
          .filter((r) => r != null);

        const encoder = new TextEncoder();
        const tenantId = context.session.tenantId;
        const installationId = active.installationId;
        const totalQuota = repos.length * JOB_QUOTA_PER_REPO;

        const stream = new ReadableStream({
          async start(controller) {
            const emit = (obj: unknown) =>
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

            let totalJobs = 0;
            let totalErrors = 0;
            let runsOffset = 0;

            for (let i = 0; i < repos.length; i++) {
              const repo = repos[i];
              emit({
                type: "repo-start",
                repoFullName: repo.full_name,
                repoIndex: i,
                reposTotal: repos.length,
              });

              const jobsBase = i * JOB_QUOTA_PER_REPO;
              const currentRunsOffset = runsOffset;

              try {
                for await (const update of backfillRepo(
                  installationId,
                  tenantId,
                  repo,
                )) {
                  emit({
                    type: "progress",
                    progress: {
                      jobsEnqueued: jobsBase + update.jobsEnqueued,
                      jobsQuota: totalQuota,
                      runsProcessed: currentRunsOffset + update.runsProcessed,
                    },
                  });
                  if (update.status === "done") {
                    runsOffset += update.runsProcessed;
                    totalJobs += update.jobsEnqueued;
                    totalErrors += update.errors?.length ?? 0;
                  }
                }
              } catch {
                totalErrors++;
                emit({ type: "repo-error", repoFullName: repo.full_name });
              }
            }

            emit({ type: "done", totalJobs, totalErrors });
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    },
  },
});
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd packages/app && pnpm test src/routes/api/cli/import.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/api/cli/import.ts packages/app/src/routes/api/cli/import.test.ts
git commit -m "feat: add POST /api/cli/import NDJSON streaming endpoint"
```

---

## Task 5: /cli/device — new-user flow

Extend the device approval page to handle org setup and GitHub App install for users who arrive without an organization in their session. After setup, the device is auto-approved.

**Files:**
- Modify: `packages/app/src/routes/cli/device.tsx`
- Modify: `packages/app/src/data/onboarding.ts`

- [ ] **Step 1: Add `ensureOrganizationForDevice` to `data/onboarding.ts`**

Add after the existing exports in `packages/app/src/data/onboarding.ts`:

```typescript
export const ensureOrganizationForDevice = createServerFn({
  method: "POST",
}).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) {
    throw new Error("unauthenticated");
  }

  if (auth.organizationId) {
    // Already has org in session — nothing to do.
    return { isNewOrg: false };
  }

  // Check if the user is already a member of any org.
  const memberships =
    await workOS.userManagement.listOrganizationMemberships({
      userId: auth.user.id,
    });

  if (memberships.data.length > 0) {
    // Switch to the most recently created org.
    const sorted = [...memberships.data].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    await switchToOrganization({ data: { organizationId: sorted[0].organizationId } });
    return { isNewOrg: false };
  }

  // No orgs — create a placeholder.
  const user = await workOS.userManagement.getUser(auth.user.id);
  const firstName = user.firstName ?? user.email.split("@")[0];
  const orgName = `${firstName}'s workspace`;

  const organization = await workOS.organizations.createOrganization({
    name: orgName,
    metadata: { onboardingCompleted: "false" },
  });

  await workOS.userManagement.createOrganizationMembership({
    organizationId: organization.id,
    userId: auth.user.id,
    roleSlug: "admin",
  });

  await switchToOrganization({ data: { organizationId: organization.id } });
  await ensureTenantForOrganizationId(organization.id);

  return { isNewOrg: true };
});
```

Also add `switchToOrganization` to the existing import at the top of the file:

```typescript
import {
  getAuth,
  switchToOrganization,
} from "@workos/authkit-tanstack-react-start";
```

(It's already imported — confirm it's in the import before adding.)

- [ ] **Step 2: Update the device page loader**

In `packages/app/src/routes/cli/device.tsx`, update the `loader` to return whether the user has an org:

```typescript
loader: async ({ deps }) => {
  const auth = await getAuth();
  return {
    deviceCode: deps.code?.toUpperCase() ?? "",
    hasOrg: !!auth.user && !!auth.organizationId,
  };
},
```

- [ ] **Step 3: Add the new-user flow component**

Replace the full `CliDeviceApprovalPage` component and the `formatCodeForDisplay` helper with the updated version below. The existing manual-confirm UI is preserved for users who already have an org.

```typescript
function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode, hasOrg } = Route.useLoaderData();

  if (!hasOrg) {
    return <NewUserDeviceFlow deviceCode={deviceCode} />;
  }

  return <ExistingUserDeviceFlow deviceCode={deviceCode} />;
}

type NewUserStep = "setup" | "github" | "approving" | "done" | "error";

function NewUserDeviceFlow({ deviceCode }: { deviceCode: string }) {
  const [step, setStep] = useState<NewUserStep>("setup");

  useEffect(() => {
    if (step !== "setup") return;
    ensureOrganizationForDevice()
      .then(() => setStep("github"))
      .catch(() => setStep("error"));
  }, [step]);

  async function handleGithubDone() {
    setStep("approving");
    try {
      const res = await fetch("/api/cli/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: deviceCode, action: "approve" }),
      });
      setStep(res.ok ? "done" : "error");
    } catch {
      setStep("error");
    }
  }

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Setting up Everr
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {step === "setup" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground text-center text-sm">
                Setting up your workspace&hellip;
              </p>
            </div>
          )}

          {step === "github" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">
                  Install the Everr GitHub App
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sync workflow runs and logs from your repositories. You can
                  skip this and do it later with{" "}
                  <code className="font-mono">everr init</code>.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    window.open(
                      "/api/github/install/start",
                      "_blank",
                      "noopener",
                    );
                  }}
                >
                  <ExternalLink className="mr-2 size-3.5" />
                  Install GitHub App
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => void handleGithubDone()}
                >
                  Skip for now
                </Button>
              </div>
              <div className="border-t border-border pt-6">
                <Button size="lg" onClick={() => void handleGithubDone()}>
                  Continue to terminal
                  <ArrowRight className="ml-2 size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {step === "approving" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground text-center text-sm">
                Activating CLI access&hellip;
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">You're all set</p>
              <p className="text-muted-foreground mt-3 text-base">
                Return to your terminal to continue.
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold text-destructive">
                Something went wrong
              </p>
              <p className="text-muted-foreground mt-3 text-base">
                Restart <code className="font-mono">everr onboarding</code> and
                try again.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ExistingUserDeviceFlow({ deviceCode }: { deviceCode: string }) {
  const [status, setStatus] = useState<
    "idle" | "approved" | "denied" | "error"
  >("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(action: "approve" | "deny") {
    if (!deviceCode) {
      setStatus("error");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/cli/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: deviceCode, action }),
    });
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus("error");
      return;
    }

    setStatus(action === "approve" ? "approved" : "denied");
  }

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Device activation
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {status === "idle" || status === "error" ? (
            <>
              <p className="text-center text-[32px] leading-none font-semibold uppercase sm:text-[56px]">
                {deviceCode
                  ? formatCodeForDisplay(deviceCode)
                  : "M I S S I N G  C O D E"}
              </p>
              <p className="text-muted-foreground mt-6 text-center text-base">
                Confirm this code is shown on your device
              </p>

              <div className="mt-10 grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={isSubmitting}
                  onClick={() => void submit("deny")}
                >
                  Deny
                </Button>
                <Button
                  size="lg"
                  disabled={isSubmitting}
                  onClick={() => void submit("approve")}
                >
                  Confirm
                </Button>
              </div>

              {status === "error" ? (
                <p className="mt-4 text-center text-sm text-red-400">
                  Invalid or expired code. Restart{" "}
                  <code className="font-mono">everr onboarding</code> from your
                  terminal.
                </p>
              ) : null}
            </>
          ) : null}

          {status === "approved" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Device approved</p>
              <p className="text-muted-foreground mt-3 text-base">
                You can return to your terminal.
              </p>
            </div>
          ) : null}

          {status === "denied" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Request denied</p>
              <p className="text-muted-foreground mt-3 text-base">
                The sign-in request was denied. You can close this page.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
```

Add the missing import `ArrowRight` to the existing lucide-react import block at the top of `device.tsx` if it's not already there.

- [ ] **Step 4: Verify the page compiles**

```bash
cd packages/app && pnpm tsc --noEmit
```

Expected: no errors in `src/routes/cli/device.tsx` or `src/data/onboarding.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes/cli/device.tsx packages/app/src/data/onboarding.ts
git commit -m "feat: extend /cli/device for new-user org setup and GitHub App install"
```

---

## Task 6: `init_repo_instructions_auto` in everr-core

**Files:**
- Modify: `crates/everr-core/src/assistant.rs`

- [ ] **Step 1: Write the failing test**

Add this test inside the `#[cfg(test)] mod tests { ... }` block in `crates/everr-core/src/assistant.rs`:

```rust
#[test]
fn init_repo_instructions_auto_creates_agents_when_neither_file_exists() {
    let repo = tempdir().expect("tempdir");
    let written = super::init_repo_instructions_auto(repo.path(), "everr")
        .expect("init repo instructions");
    assert_eq!(written, vec![repo.path().join("AGENTS.md")]);
    let content = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read");
    assert!(content.contains("<!-- BEGIN everr -->"));
}

#[test]
fn init_repo_instructions_auto_writes_agents_when_agents_exists() {
    let repo = tempdir().expect("tempdir");
    fs::write(repo.path().join("AGENTS.md"), "# existing\n").expect("seed");
    let written = super::init_repo_instructions_auto(repo.path(), "everr")
        .expect("init repo instructions");
    assert_eq!(written.len(), 1);
    assert!(written[0].ends_with("AGENTS.md"));
    let content = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read");
    assert!(content.contains("# existing"));
    assert!(content.contains("<!-- BEGIN everr -->"));
}

#[test]
fn init_repo_instructions_auto_writes_claude_when_claude_exists() {
    let repo = tempdir().expect("tempdir");
    fs::write(repo.path().join("CLAUDE.md"), "# existing claude\n").expect("seed");
    let written = super::init_repo_instructions_auto(repo.path(), "everr")
        .expect("init repo instructions");
    assert_eq!(written.len(), 1);
    assert!(written[0].ends_with("CLAUDE.md"));
    let content = fs::read_to_string(repo.path().join("CLAUDE.md")).expect("read");
    assert!(content.contains("<!-- BEGIN everr -->"));
    assert!(!repo.path().join("AGENTS.md").exists());
}

#[test]
fn init_repo_instructions_auto_writes_both_when_both_exist() {
    let repo = tempdir().expect("tempdir");
    fs::write(repo.path().join("AGENTS.md"), "# agents\n").expect("seed agents");
    fs::write(repo.path().join("CLAUDE.md"), "# claude\n").expect("seed claude");
    let written = super::init_repo_instructions_auto(repo.path(), "everr")
        .expect("init repo instructions");
    assert_eq!(written.len(), 2);
    let agents = fs::read_to_string(repo.path().join("AGENTS.md")).expect("read agents");
    let claude = fs::read_to_string(repo.path().join("CLAUDE.md")).expect("read claude");
    assert!(agents.contains("<!-- BEGIN everr -->"));
    assert!(claude.contains("<!-- BEGIN everr -->"));
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p everr-core -- init_repo_instructions_auto
```

Expected: compile error — `init_repo_instructions_auto` not found.

- [ ] **Step 3: Implement the function**

Add after `init_repo_instructions` in `crates/everr-core/src/assistant.rs`:

```rust
/// Writes Everr discovery instructions to repo-level assistant files.
///
/// - If AGENTS.md or CLAUDE.md is present: writes/updates whichever exist.
/// - If neither is present: creates AGENTS.md.
/// - Returns the paths of all files written.
pub fn init_repo_instructions_auto(cwd: &Path, command_name: &str) -> Result<Vec<PathBuf>> {
    let agents_path = cwd.join("AGENTS.md");
    let claude_path = cwd.join("CLAUDE.md");

    let agents_exists = agents_path.exists();
    let claude_exists = claude_path.exists();

    let mut written = Vec::new();
    let content = repo_content(command_name);

    if agents_exists || !claude_exists {
        write_generic_managed_block(&agents_path, &content)?;
        written.push(agents_path);
    }

    if claude_exists {
        write_generic_managed_block(&claude_path, &content)?;
        written.push(claude_path);
    }

    Ok(written)
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cargo test -p everr-core -- init_repo_instructions_auto
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/everr-core/src/assistant.rs
git commit -m "feat: add init_repo_instructions_auto for AGENTS.md and CLAUDE.md detection"
```

---

## Task 7: ApiClient additions in everr-core

**Files:**
- Modify: `crates/everr-core/src/api.rs`

- [ ] **Step 1: Add new response types**

Add these structs at the bottom of the types section in `crates/everr-core/src/api.rs` (after `NotifyPayload`):

```rust
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OrgResponse {
    pub name: String,
    pub is_only_admin: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoEntry {
    pub id: i64,
    pub full_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ImportEvent {
    #[serde(rename_all = "camelCase")]
    RepoStart {
        repo_full_name: String,
        repo_index: u32,
        repos_total: u32,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        progress: ImportProgress,
    },
    #[serde(rename_all = "camelCase")]
    RepoError {
        repo_full_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        total_jobs: u32,
        total_errors: u32,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub jobs_enqueued: u32,
    pub jobs_quota: u32,
    pub runs_processed: u32,
}
```

- [ ] **Step 2: Write tests for new ApiClient methods**

Add a new `#[cfg(test)] mod tests` block at the bottom of `crates/everr-core/src/api.rs`. If one exists already, append inside it.

```rust
#[cfg(test)]
mod api_client_tests {
    use super::*;

    fn make_session(base_url: &str) -> crate::state::Session {
        crate::state::Session {
            api_base_url: base_url.to_string(),
            token: "test-token".to_string(),
        }
    }

    #[tokio::test]
    async fn get_org_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/org")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"name":"Acme Inc.","isOnlyAdmin":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let org = client.get_org().await.unwrap();

        assert_eq!(org.name, "Acme Inc.");
        assert!(org.is_only_admin);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn patch_org_name_sends_correct_body() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("PATCH", "/api/cli/org/name")
            .match_body(r#"{"name":"New Name"}"#)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        client.patch_org_name("New Name").await.unwrap();

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn get_repos_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/api/cli/repos")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[{"id":1,"fullName":"acme/api"},{"id":2,"fullName":"acme/web"}]"#)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let repos = client.get_repos().await.unwrap();

        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].full_name, "acme/api");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn import_repos_parses_ndjson_stream() {
        let ndjson = concat!(
            r#"{"type":"repo-start","repoFullName":"acme/api","repoIndex":0,"reposTotal":1}"#, "\n",
            r#"{"type":"done","totalJobs":5,"totalErrors":0}"#, "\n",
        );

        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/api/cli/import")
            .with_status(200)
            .with_header("content-type", "application/x-ndjson")
            .with_body(ndjson)
            .create_async()
            .await;

        let client = ApiClient::from_session(&make_session(&server.url())).unwrap();
        let events = client
            .import_repos(&["acme/api".to_string()])
            .await
            .unwrap();

        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], ImportEvent::RepoStart { .. }));
        assert!(matches!(events[1], ImportEvent::Done { total_jobs: 5, total_errors: 0 }));
        mock.assert_async().await;
    }
}
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cargo test -p everr-core -- api_client_tests
```

Expected: compile errors — methods `get_org`, `patch_org_name`, `get_repos`, `import_repos` not defined.

Also add `mockito` to `crates/everr-core/Cargo.toml` dev-dependencies:

```toml
[dev-dependencies]
tempfile = "3.18.0"
mockito = "1.7.0"
```

- [ ] **Step 4: Implement the ApiClient methods**

Add these methods inside the `impl ApiClient` block in `crates/everr-core/src/api.rs`:

```rust
pub async fn get_org(&self) -> Result<OrgResponse> {
    self.get("/org", &[]).await
}

pub async fn patch_org_name(&self, name: &str) -> Result<()> {
    let response = self
        .http
        .patch(format!("{}/org/name", self.base_endpoint))
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .context("PATCH org name request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        bail!("PATCH org name failed with {status}: {text}");
    }

    Ok(())
}

pub async fn get_repos(&self) -> Result<Vec<RepoEntry>> {
    self.get("/repos", &[]).await
}

/// Streams the import for the given repos and collects all events.
pub async fn import_repos(&self, repos: &[String]) -> Result<Vec<ImportEvent>> {
    let response = self
        .http
        .post(format!("{}/import", self.base_endpoint))
        .json(&serde_json::json!({ "repos": repos }))
        .send()
        .await
        .context("import request failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());
        bail!("import request failed with {status}: {text}");
    }

    let body = response.text().await.context("failed to read import body")?;
    let events = body
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<ImportEvent>(line)
                .with_context(|| format!("failed to parse import event: {line}"))
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(events)
}
```

> **Note:** `import_repos` collects all events rather than streaming them, which is simpler to implement and sufficient for the CLI's progress display. The NDJSON format is preserved on the wire.

- [ ] **Step 5: Run tests and confirm they pass**

```bash
cargo test -p everr-core -- api_client_tests
```

- [ ] **Step 6: Commit**

```bash
git add crates/everr-core/src/api.rs crates/everr-core/Cargo.toml
git commit -m "feat: add OrgResponse, RepoEntry, ImportEvent types and ApiClient methods"
```

---

## Task 8: `everr onboarding` command

Create `onboarding.rs` as a replacement for `setup.rs`, adding org rename and import steps.

**Files:**
- Create: `packages/desktop-app/src-cli/src/onboarding.rs`
- Modify: `packages/desktop-app/src-cli/src/setup.rs` (kept for reference until Task 10)

- [ ] **Step 1: Write a test for the rename-org prompt logic**

Add a test module in the new file (TDD — write it first):

```rust
// packages/desktop-app/src-cli/src/onboarding.rs
#[cfg(test)]
mod tests {
    #[test]
    fn clean_org_name_trims_whitespace() {
        assert_eq!(super::clean_org_name("  Acme Inc.  "), "Acme Inc.");
    }

    #[test]
    fn clean_org_name_preserves_inner_spaces() {
        assert_eq!(super::clean_org_name("Acme Corp"), "Acme Corp");
    }
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cargo test -p everr-cli -- onboarding::tests
```

Expected: compile error — module not found.

- [ ] **Step 3: Implement `onboarding.rs`**

Create `packages/desktop-app/src-cli/src/onboarding.rs` with the following content. This is adapted from `setup.rs`, with `run_setup()` → `run()` and two new steps inserted between authentication and notification emails.

```rust
use std::fmt::Write as _;
use std::io::IsTerminal;
use std::path::Path;
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result};
use everr_core::api::ApiClient;
use everr_core::assistant::{self as core_assistant, AssistantKind};
use everr_core::auth::login_with_prompt;
use everr_core::build;
use everr_core::state::Session;

use crate::auth;

const LOGO_LINES: &[&str] = &["⢠⡾⢻⣦⡀", "⣿⠁⣾⣉⣻⣦⡀", "⣿ ⣿⣉⣽⢿⡿⣦⡀", "⠘⣧⡈⠻⣧⣼⣧⡼⠿⣦", " ⠈⠛⠶⣤⣤⣤⣴⠾⠋"];
const WORDMARK_LINES: &[&str] = &[
    "░████████ ░██    ░██  ░███████  ░██░████ ░██░████",
    "░██       ░██    ░██ ░██    ░██ ░███     ░███",
    "░███████   ░██  ░██  ░█████████ ░██      ░██",
    "░██         ░██░██   ░██        ░██      ░██",
    "░████████    ░███     ░███████  ░██      ░██",
];
const LOGO_COLUMN_WIDTH: usize = 10;
const BANNER_COLOR: &str = "\x1b[38;2;223;255;0m";
const ANSI_RESET: &str = "\x1b[0m";

pub async fn run() -> Result<()> {
    println!();
    print_banner();

    cliclack::intro("Onboarding")?;

    let session = step_authenticate().await?;
    step_rename_org(&session).await?;
    step_import_repos(&session).await?;
    step_configure_notification_emails(&session).await?;
    step_configure_assistants()?;
    step_install_desktop_app().await?;

    cliclack::outro("Everr is ready.")?;
    Ok(())
}

pub(crate) fn clean_org_name(name: &str) -> String {
    name.trim().to_string()
}

async fn step_authenticate() -> Result<Session> {
    let store = auth::state_store();
    let config = auth::resolve_auth_config()?;

    match store.load_session_for_api_base_url(&config.api_base_url) {
        Ok(session) => {
            cliclack::log::success("Already logged in.")?;
            Ok(session)
        }
        Err(_) => {
            let session =
                login_with_prompt(&config, &store, auth::show_device_sign_in_prompt).await?;
            cliclack::log::success("Logged in.")?;
            Ok(session)
        }
    }
}

async fn step_rename_org(session: &Session) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    if !interactive {
        return Ok(());
    }

    let client = ApiClient::from_session(session)?;
    let org = match client.get_org().await {
        Ok(org) => org,
        Err(_) => return Ok(()), // non-fatal: skip if API unavailable
    };

    if !org.is_only_admin {
        return Ok(());
    }

    let input: String = cliclack::input("Organization name")
        .default_input(&org.name)
        .interact()?;

    let new_name = clean_org_name(&input);
    if new_name == org.name || new_name.is_empty() {
        return Ok(());
    }

    client.patch_org_name(&new_name).await?;
    cliclack::log::success(format!("Organization renamed to \"{new_name}\""))?;
    Ok(())
}

async fn step_import_repos(session: &Session) -> Result<()> {
    let interactive = std::io::stdin().is_terminal();

    let client = ApiClient::from_session(session)?;
    let repos = match client.get_repos().await {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };

    if repos.is_empty() {
        return Ok(());
    }

    if !interactive {
        return Ok(());
    }

    const MAX_REPOS: usize = 3;

    let mut prompt = cliclack::multiselect("Select repositories to import (up to 3)");
    for repo in &repos {
        prompt = prompt.item(repo.full_name.clone(), repo.full_name.clone(), "");
    }
    let selected: Vec<String> = prompt.interact()?;

    if selected.is_empty() {
        cliclack::log::remark("No repositories selected, skipping import.")?;
        return Ok(());
    }

    let to_import: Vec<String> = selected.into_iter().take(MAX_REPOS).collect();

    let spinner = cliclack::spinner();
    spinner.start("Importing workflow history…");

    let events = client.import_repos(&to_import).await?;

    let done = events.iter().find_map(|e| {
        if let everr_core::api::ImportEvent::Done {
            total_jobs,
            total_errors,
        } = e
        {
            Some((*total_jobs, *total_errors))
        } else {
            None
        }
    });

    match done {
        Some((jobs, 0)) => spinner.stop(format!("Imported {jobs} workflow runs.")),
        Some((jobs, errors)) => spinner.stop(format!(
            "Imported {jobs} runs ({errors} errors — some repos may be incomplete)."
        )),
        None => spinner.stop("Import complete."),
    }

    Ok(())
}

const ADD_EMAIL_SENTINEL: &str = "__add_email__";

async fn step_configure_notification_emails(session: &Session) -> Result<()> {
    let store = auth::state_store();
    let saved: Vec<String> = store
        .load_state()
        .map(|s| s.settings.notification_emails)
        .unwrap_or_default();
    let mut detected: Vec<String> = Vec::new();

    if let Ok(client) = everr_core::api::ApiClient::from_session(session) {
        if let Ok(me) = client.get_me().await {
            detected.push(me.email.clone());
            store.update_state(|state| {
                state.settings.user_profile = Some(everr_core::state::UserProfile {
                    email: me.email,
                    name: me.name,
                    profile_url: me.profile_url,
                });
            })?;
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let git = everr_core::git::resolve_git_context(&cwd);
        if let Some(git_email) = git.email {
            if !detected.contains(&git_email) {
                detected.push(git_email);
            }
        }
    }

    let mut all_emails = saved.clone();
    for email in &detected {
        if !all_emails.contains(email) {
            all_emails.push(email.clone());
        }
    }

    let initial: Vec<String> = if saved.is_empty() {
        detected.clone()
    } else {
        saved.clone()
    };

    let interactive = std::io::stdin().is_terminal();

    if !interactive {
        if !all_emails.is_empty() {
            store.update_state(|state| {
                state.settings.notification_emails = all_emails;
            })?;
        }
        return Ok(());
    }

    cliclack::note(
        "Notification emails",
        "These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally.",
    )?;

    let mut prompt = cliclack::multiselect("Select notification emails");
    for email in &all_emails {
        prompt = prompt.item(email.clone(), email.clone(), "");
    }
    prompt = prompt.item(ADD_EMAIL_SENTINEL.to_string(), "Add email…", "");

    let mut selected: Vec<String> = prompt.initial_values(initial).interact()?;

    let add_requested = selected.contains(&ADD_EMAIL_SENTINEL.to_string());
    selected.retain(|e| e != ADD_EMAIL_SENTINEL);

    if add_requested {
        let custom: String = cliclack::input("Email address").interact()?;
        let custom = custom.trim().to_string();
        if !custom.is_empty() && !selected.contains(&custom) {
            selected.push(custom);
        }
    }

    let notification_emails = if selected.is_empty() { detected } else { selected };

    store.update_state(|state| {
        state.settings.notification_emails = notification_emails;
    })?;

    cliclack::log::success("Notification emails configured")?;
    Ok(())
}

fn step_configure_assistants() -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    let statuses = core_assistant::assistant_statuses()?;

    let all_configured = statuses.iter().all(|s| !s.detected || s.configured);

    if all_configured && statuses.iter().any(|s| s.configured) {
        let configured_list: Vec<String> = statuses
            .iter()
            .filter(|s| s.configured)
            .map(|s| format!("{} ({})", display_name(s.assistant), s.path))
            .collect();
        cliclack::log::success(format!(
            "Assistants already configured:\n{}",
            configured_list.join("\n")
        ))?;

        if !interactive {
            return Ok(());
        }

        let reconfigure: bool = cliclack::confirm("Re-configure assistants?")
            .initial_value(false)
            .interact()?;

        if !reconfigure {
            return Ok(());
        }
    }

    let selected_assistants: Vec<AssistantKind> = if interactive {
        let mut prompt = cliclack::multiselect("Select assistants to configure");
        for (i, s) in statuses.iter().enumerate() {
            let label = display_name(s.assistant);
            let hint = &s.path;
            prompt = prompt.item(i, label, hint);
        }
        prompt = prompt.initial_values(
            statuses
                .iter()
                .enumerate()
                .filter(|(_, s)| s.detected)
                .map(|(i, _)| i)
                .collect(),
        );

        let selected_indices: Vec<usize> = prompt.interact()?;
        selected_indices
            .iter()
            .map(|&i| statuses[i].assistant)
            .collect()
    } else {
        statuses
            .iter()
            .filter(|s| s.detected)
            .map(|s| s.assistant)
            .collect()
    };

    if selected_assistants.is_empty() {
        cliclack::log::remark("No assistants selected.")?;
        return Ok(());
    }

    core_assistant::sync_discovery_assistants(&selected_assistants, build::command_name())?;

    cliclack::log::success("Assistants configured")?;

    Ok(())
}

async fn step_install_desktop_app() -> Result<()> {
    let interactive = std::io::stdin().is_terminal();
    let app_path = Path::new("/Applications/Everr.app");
    let already_installed = app_path.exists();

    let running = ProcessCommand::new("pgrep")
        .args(["-x", "Everr"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if running {
        cliclack::log::success("Desktop app is already running in the menu bar.")?;
        return Ok(());
    }

    if already_installed {
        let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
        cliclack::log::success("Desktop app is now running in the menu bar.")?;
        return Ok(());
    }

    if !interactive {
        cliclack::log::remark("Install the desktop app from https://everr.dev")?;
        return Ok(());
    }

    let install: bool = cliclack::confirm("Do you want to install the Everr desktop app?\n\nThe desktop app runs in the menu bar and notifies you\nwhen your CI/CD pipelines fail or need attention.")
        .initial_value(true)
        .interact()?;

    if !install {
        cliclack::log::remark("You can install it later from https://everr.dev")?;
        return Ok(());
    }

    {
        let dmg_url = format!(
            "{}/everr-app/everr-macos-arm64.dmg",
            build::default_docs_base_url()
        );

        let spinner = cliclack::spinner();
        spinner.start("Downloading desktop app...");

        let tmp_dir = tempfile::tempdir().context("failed to create temp dir")?;
        let dmg_path = tmp_dir.path().join("Everr.dmg");

        let response = reqwest::get(&dmg_url)
            .await
            .context("failed to download desktop app")?;
        let bytes = response.bytes().await.context("failed to read download")?;
        std::fs::write(&dmg_path, &bytes).context("failed to write DMG")?;

        spinner.set_message("Mounting disk image...");

        let mount_output = ProcessCommand::new("hdiutil")
            .args(["attach", "-nobrowse", "-noautoopen"])
            .arg(&dmg_path)
            .output()
            .context("failed to mount DMG")?;

        let stdout = String::from_utf8_lossy(&mount_output.stdout);
        let mount_point = stdout
            .lines()
            .last()
            .and_then(|line| line.split('\t').last())
            .map(|s| s.trim().to_string())
            .context("failed to find mount point")?;

        spinner.set_message("Extracting app to Applications...");

        let copy_result = ProcessCommand::new("cp")
            .args(["-R"])
            .arg(format!("{mount_point}/Everr.app"))
            .arg("/Applications/")
            .status();

        let _ = ProcessCommand::new("hdiutil")
            .args(["detach", &mount_point, "-quiet"])
            .status();

        copy_result.context("failed to copy app to /Applications")?;

        spinner.stop("Desktop app installed to /Applications/Everr.app");
    }

    let _ = ProcessCommand::new("open").args(["-a", "Everr"]).status();
    cliclack::log::success("Desktop app is now running in the menu bar.")?;

    Ok(())
}

fn display_name(kind: AssistantKind) -> &'static str {
    match kind {
        AssistantKind::Claude => "Claude Code",
        AssistantKind::Codex => "Codex",
        AssistantKind::Cursor => "Cursor",
    }
}

fn print_banner() {
    let banner = render_banner();
    if should_use_color() {
        print!("{BANNER_COLOR}{banner}{ANSI_RESET}");
    } else {
        print!("{banner}");
    }
    println!();
}

fn render_banner() -> String {
    let mut banner = String::new();
    let total_lines = LOGO_LINES.len().max(WORDMARK_LINES.len());
    for line_index in 0..total_lines {
        let logo = LOGO_LINES.get(line_index).copied().unwrap_or("");
        let wordmark = WORDMARK_LINES.get(line_index).copied().unwrap_or("");
        if wordmark.is_empty() {
            writeln!(&mut banner, "{logo}").expect("banner line");
        } else {
            writeln!(&mut banner, "{logo:<width$}   {wordmark}", width = LOGO_COLUMN_WIDTH)
                .expect("banner line");
        }
    }
    banner
}

fn should_use_color() -> bool {
    std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM")
            .map(|term| term != "dumb")
            .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    #[test]
    fn clean_org_name_trims_whitespace() {
        assert_eq!(super::clean_org_name("  Acme Inc.  "), "Acme Inc.");
    }

    #[test]
    fn clean_org_name_preserves_inner_spaces() {
        assert_eq!(super::clean_org_name("Acme Corp"), "Acme Corp");
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cargo test -p everr-cli -- onboarding::tests
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src-cli/src/onboarding.rs
git commit -m "feat: implement everr onboarding command with org rename and import steps"
```

---

## Task 9: `everr init` command

**Files:**
- Create: `packages/desktop-app/src-cli/src/init.rs`

- [ ] **Step 1: Write tests**

```rust
// packages/desktop-app/src-cli/src/init.rs
#[cfg(test)]
mod tests {
    use super::parse_repo_from_remote;

    #[test]
    fn parses_https_remote() {
        assert_eq!(
            parse_repo_from_remote("https://github.com/acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote_without_git_suffix() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn returns_none_for_non_github_remote() {
        assert_eq!(
            parse_repo_from_remote("https://gitlab.com/acme/api.git"),
            None
        );
    }

    #[test]
    fn returns_none_for_malformed_remote() {
        assert_eq!(parse_repo_from_remote("not-a-url"), None);
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cargo test -p everr-cli -- init::tests
```

Expected: compile error — module not found.

- [ ] **Step 3: Implement `init.rs`**

```rust
// packages/desktop-app/src-cli/src/init.rs
use std::process::Command as ProcessCommand;

use anyhow::{Context, Result, bail};
use everr_core::api::ApiClient;
use everr_core::assistant as core_assistant;
use everr_core::build;

use crate::auth;

pub async fn run() -> Result<()> {
    // Step 1: require auth
    let session = auth::require_session_with_refresh()
        .await
        .context("not logged in; run `everr onboarding` first")?;

    // Step 2: detect repo
    let cwd = std::env::current_dir().context("could not determine current directory")?;
    let repo_full_name = detect_repo_full_name(&cwd)?;

    let client = ApiClient::from_session(&session)?;

    // Step 3: import if GitHub App installed and no existing runs
    let repos = client.get_repos().await.unwrap_or_default();
    let github_installed = repos.iter().any(|r| r.full_name == repo_full_name);

    if !github_installed {
        cliclack::log::remark(format!(
            "GitHub App not installed for this repo.\nInstall it from https://everr.dev, then re-run `{} init`.",
            build::command_name()
        ))?;
    } else {
        let has_runs = has_existing_runs(&client, &repo_full_name).await;

        if has_runs {
            cliclack::log::success(format!(
                "Runs already imported for {repo_full_name}, skipping."
            ))?;
        } else {
            let spinner = cliclack::spinner();
            spinner.start(format!("Importing workflow history for {repo_full_name}…"));

            match client.import_repos(&[repo_full_name.clone()]).await {
                Ok(events) => {
                    let done = events.iter().find_map(|e| {
                        if let everr_core::api::ImportEvent::Done {
                            total_jobs,
                            total_errors,
                        } = e
                        {
                            Some((*total_jobs, *total_errors))
                        } else {
                            None
                        }
                    });
                    match done {
                        Some((jobs, 0)) => {
                            spinner.stop(format!("Imported {jobs} workflow runs."))
                        }
                        Some((jobs, errors)) => spinner.stop(format!(
                            "Imported {jobs} runs ({errors} errors)."
                        )),
                        None => spinner.stop("Import complete."),
                    }
                }
                Err(e) => {
                    spinner.stop(format!("Import failed: {e}"));
                }
            }
        }
    }

    // Step 4: write assistant instructions
    let written =
        core_assistant::init_repo_instructions_auto(&cwd, build::command_name())?;
    for path in &written {
        cliclack::log::success(format!("Updated {}", path.display()))?;
    }

    cliclack::outro(format!(
        "{} init complete.",
        build::command_name()
    ))?;

    Ok(())
}

fn detect_repo_full_name(cwd: &std::path::Path) -> Result<String> {
    let output = ProcessCommand::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .context("failed to run git remote get-url origin")?;

    if !output.status.success() {
        bail!("could not detect git remote; make sure this directory has a remote named 'origin'");
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_repo_from_remote(&remote)
        .ok_or_else(|| anyhow::anyhow!("remote '{remote}' does not appear to be a GitHub repo"))
}

pub(crate) fn parse_repo_from_remote(remote: &str) -> Option<String> {
    let without_git = remote.trim_end_matches(".git");

    // https://github.com/owner/repo
    if let Some(rest) = without_git.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
    }

    // git@github.com:owner/repo
    if let Some(rest) = without_git.strip_prefix("git@github.com:") {
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
    }

    None
}

async fn has_existing_runs(client: &ApiClient, repo_full_name: &str) -> bool {
    // Reuse the existing runs-list endpoint with limit=1 to check for any data.
    let query = [
        ("repo", repo_full_name.to_string()),
        ("limit", "1".to_string()),
    ];
    match client.get_runs_list(&query).await {
        Ok(value) => value
            .get("runs")
            .and_then(|r| r.as_array())
            .map(|arr| !arr.is_empty())
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_repo_from_remote;

    #[test]
    fn parses_https_remote() {
        assert_eq!(
            parse_repo_from_remote("https://github.com/acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api.git"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn parses_ssh_remote_without_git_suffix() {
        assert_eq!(
            parse_repo_from_remote("git@github.com:acme/api"),
            Some("acme/api".to_string())
        );
    }

    #[test]
    fn returns_none_for_non_github_remote() {
        assert_eq!(
            parse_repo_from_remote("https://gitlab.com/acme/api.git"),
            None
        );
    }

    #[test]
    fn returns_none_for_malformed_remote() {
        assert_eq!(parse_repo_from_remote("not-a-url"), None);
    }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cargo test -p everr-cli -- init::tests
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop-app/src-cli/src/init.rs
git commit -m "feat: implement everr init command"
```

---

## Task 10: Wire up CLI — rename Setup → Onboarding, add Init

**Files:**
- Modify: `packages/desktop-app/src-cli/src/cli.rs`
- Modify: `packages/desktop-app/src-cli/src/main.rs`
- Delete: `packages/desktop-app/src-cli/src/setup.rs`

- [ ] **Step 1: Update `cli.rs`**

In `packages/desktop-app/src-cli/src/cli.rs`, replace the `Setup` variant and its test with:

```rust
    /// Run the full onboarding wizard (login + org + import + assistant configuration)
    #[command(alias = "setup")]
    Onboarding,
    /// Initialize the current repository (import runs + write assistant instructions)
    Init,
```

Remove (or update) the existing `Setup` test:

```rust
#[test]
fn onboarding_parses_without_arguments() {
    let cli = Cli::try_parse_from(["everr", "onboarding"]).expect("onboarding command");
    assert!(matches!(cli.command, Commands::Onboarding));
}

#[test]
fn setup_alias_resolves_to_onboarding() {
    let cli = Cli::try_parse_from(["everr", "setup"]).expect("setup alias");
    assert!(matches!(cli.command, Commands::Onboarding));
}

#[test]
fn init_parses_without_arguments() {
    let cli = Cli::try_parse_from(["everr", "init"]).expect("init command");
    assert!(matches!(cli.command, Commands::Init));
}
```

- [ ] **Step 2: Update `main.rs`**

Replace `setup.rs` references with `onboarding` and add `init`:

```rust
mod api;
mod assistant;
mod auth;
mod cli;
mod core;
mod init;
mod onboarding;
mod uninstall;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Uninstall => uninstall::run_uninstall()?,
        Commands::Login(login) => auth::login(login).await?,
        Commands::Logout => auth::logout()?,
        Commands::SetupAssistant => assistant::print_repo_instructions(),
        Commands::AiInstructions => assistant::print_ai_instructions(),
        Commands::Status(args) => core::status(args).await?,
        Commands::Grep(args) => core::grep(args).await?,
        Commands::TestHistory(args) => core::test_history(args).await?,
        Commands::SlowestTests(args) => core::slowest_tests(args).await?,
        Commands::SlowestJobs(args) => core::slowest_jobs(args).await?,
        Commands::Watch(args) => core::watch(args).await?,
        Commands::RunsList(args) => core::runs_list(args).await?,
        Commands::RunsShow(args) => core::runs_show(args).await?,
        Commands::RunsLogs(args) => core::runs_logs(args).await?,
        Commands::WorkflowsList(args) => core::workflows_list(args).await?,
        Commands::Onboarding => onboarding::run().await?,
        Commands::Init => init::run().await?,
    }

    Ok(())
}
```

- [ ] **Step 3: Delete `setup.rs`**

```bash
rm packages/desktop-app/src-cli/src/setup.rs
```

- [ ] **Step 4: Run all CLI tests**

```bash
cargo test -p everr-cli
```

Expected: all tests pass including the new onboarding/setup-alias/init tests.

- [ ] **Step 5: Build the CLI to verify it compiles**

```bash
cargo build -p everr-cli
```

Expected: no errors.

- [ ] **Step 6: Run all server tests**

```bash
cd packages/app && pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-app/src-cli/src/cli.rs packages/desktop-app/src-cli/src/main.rs
git commit -m "feat: rename everr setup to everr onboarding, add everr init"
```

---

## Self-Review

**Spec coverage:**
- ✅ `/cli/device` extended for new users (org auto-create + GitHub App + auto-approve)
- ✅ `GET /api/cli/org` + `isOnlyAdmin`
- ✅ `PATCH /api/cli/org/name`
- ✅ `GET /api/cli/repos`
- ✅ `POST /api/cli/import` NDJSON streaming
- ✅ `everr onboarding` — auth, rename org (only admin), import (if GitHub installed), emails, assistants, desktop app
- ✅ `everr init` — auth check, repo detection, import (GitHub installed + no existing runs), AGENTS.md/CLAUDE.md detection
- ✅ `init_repo_instructions_auto` — writes AGENTS.md, CLAUDE.md, or both based on presence
- ✅ `Setup` → `Onboarding` rename with `setup` alias

**Placeholder scan:** No TBDs, no "implement later" patterns.

**Type consistency:**
- `ImportEvent` enum used consistently across Task 4 (server), Task 7 (Rust types), Task 8 (onboarding step), Task 9 (init step)
- `RepoEntry.full_name` (Rust snake_case) ↔ server returns `fullName` (camelCase) — handled by `#[serde(rename_all = "camelCase")]` on the struct
- `OrgResponse.is_only_admin` (Rust) ↔ server returns `isOnlyAdmin` — handled by `#[serde(rename_all = "camelCase")]`
- `client.get_runs_list` used in Task 9 — already defined in `api.rs`
