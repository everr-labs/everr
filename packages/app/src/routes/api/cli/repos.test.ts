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
      { id: 1, full_name: "org/repo-a" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
      { id: 2, full_name: "org/repo-b" } as Awaited<
        ReturnType<typeof mockedListRepos>
      >[number],
    ]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 1, fullName: "org/repo-a" },
      { id: 2, fullName: "org/repo-b" },
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
