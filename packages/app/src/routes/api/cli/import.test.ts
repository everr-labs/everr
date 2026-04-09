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
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";
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
        body: JSON.stringify({ repos: ["org/repo-a"] }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(400);
  });

  it("returns ok immediately and starts backfill in background", async () => {
    mockedGetInstallations.mockResolvedValueOnce([
      { status: "active", installationId: 99 } as Awaited<
        ReturnType<typeof mockedGetInstallations>
      >[number],
    ]);
    mockedListRepos.mockResolvedValueOnce([
      { id: 1, full_name: "org/repo-a" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
    ]);

    async function* fakeBackfill() {
      yield {
        status: "done" as const,
        jobsEnqueued: 5,
        jobsQuota: 100,
        runsProcessed: 2,
        errors: [],
      };
    }
    mockedBackfillRepo.mockReturnValueOnce(fakeBackfill());

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/import", {
        method: "POST",
        body: JSON.stringify({ repos: ["org/repo-a"] }),
        headers: { "content-type": "application/json" },
      }),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
