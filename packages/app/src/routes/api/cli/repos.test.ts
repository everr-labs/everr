import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { listInstallationRepos } from "@/server/github-events/backfill";
import {
  cliSessionContext,
  getRouteHandler,
  mockDbInstallations,
} from "./-test-utils";
import { Route } from "./repos";

vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  githubInstallationOrganizations: {
    githubInstallationId: "github_installation_id",
    status: "status",
    organizationId: "organization_id",
  },
}));

vi.mock("@/server/github-events/backfill", () => ({
  listInstallationRepos: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedListRepos = vi.mocked(listInstallationRepos);

type GetHandler = (args: {
  request: Request;
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): GetHandler {
  return getRouteHandler<GetHandler>(Route, "GET", "/api/cli/repos");
}

const context = cliSessionContext();

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/repos", () => {
  it("returns empty array when no active installation exists", async () => {
    mockDbInstallations(mockedDb, [
      { status: "uninstalled", installationId: 1 },
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
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
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

  it("returns empty array when the active installation is missing in GitHub", async () => {
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
    mockedListRepos.mockRejectedValueOnce(
      new Error(
        'Failed to create installation token: status=404 body={"message":"Not Found"}',
      ),
    );

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedListRepos).toHaveBeenCalledWith(99);
  });

  it("rethrows unexpected GitHub repository lookup errors", async () => {
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
    mockedListRepos.mockRejectedValueOnce(new Error("GitHub unavailable"));

    await expect(
      getHandler()({
        request: new Request("http://localhost/api/cli/repos"),
        context,
      }),
    ).rejects.toThrow("GitHub unavailable");
  });

  it("returns empty array when tenant has no installations", async () => {
    mockDbInstallations(mockedDb, []);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(await response.json()).toEqual([]);
  });
});
