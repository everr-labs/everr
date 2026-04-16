import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { listInstallationRepos } from "@/server/github-events/backfill";
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
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { GET?: GetHandler } };
  };
  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) throw new Error("Missing GET handler for /api/cli/repos.");
  return handler;
}

const context = { session: { session: { activeOrganizationId: "org-42" } } };

function mockDbInstallations(
  installations: Array<{ installationId: number; status: string }>,
) {
  const where = vi.fn().mockResolvedValue(
    installations.map((i) => ({
      installationId: i.installationId,
      status: i.status,
    })),
  );
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(mockedDb.select).mockReturnValue({ from } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("/api/cli/repos", () => {
  it("returns empty array when no active installation exists", async () => {
    mockDbInstallations([{ status: "uninstalled", installationId: 1 }]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(mockedListRepos).not.toHaveBeenCalled();
  });

  it("returns repos from active installation", async () => {
    mockDbInstallations([{ status: "active", installationId: 99 }]);
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
    mockDbInstallations([]);

    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/repos"),
      context,
    });

    expect(await response.json()).toEqual([]);
  });
});
