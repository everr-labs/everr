import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { listInstallationRepos } from "@/server/github-events/backfill";
import { GitHubApiError } from "@/server/github-events/github-api";
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

function callRepos() {
  return getHandler()({
    request: new Request("http://localhost/api/cli/repos"),
    context,
  });
}

describe("/api/cli/repos", () => {
  it.each([
    { label: "no installations at all", installations: [] },
    {
      label: "only uninstalled installations",
      installations: [{ status: "uninstalled", installationId: 1 }],
    },
  ])("returns an empty list when the tenant has $label", async ({
    installations,
  }) => {
    mockDbInstallations(mockedDb, installations);

    const response = await callRepos();

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

    const response = await callRepos();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 1, fullName: "org/repo-a" },
      { id: 2, fullName: "org/repo-b" },
    ]);
    expect(mockedListRepos).toHaveBeenCalledWith(99);
  });

  it("returns an empty list when GitHub 404s for the installation", async () => {
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
    mockedListRepos.mockRejectedValueOnce(
      new GitHubApiError(
        404,
        'Failed to create installation token: status=404 body={"message":"Not Found"}',
      ),
    );

    const response = await callRepos();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedListRepos).toHaveBeenCalledWith(99);
  });

  it.each([
    {
      label: "GitHub API errors that are not 404",
      error: new GitHubApiError(500, "GitHub API error: status=500 body={}"),
      message: "GitHub API error: status=500 body={}",
    },
    {
      label: "unexpected repository lookup errors",
      error: new Error("GitHub unavailable"),
      message: "GitHub unavailable",
    },
  ])("rethrows $label", async ({ error, message }) => {
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
    mockedListRepos.mockRejectedValueOnce(error);

    await expect(callRepos()).rejects.toThrow(message);
  });
});
