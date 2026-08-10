import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";
import {
  CLI_TEST_ORG_ID,
  getRouteHandler,
  mockDbInstallations,
} from "./-test-utils";
import { Route } from "./import";

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
  backfillRepo: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedListRepos = vi.mocked(listInstallationRepos);
const mockedBackfillRepo = vi.mocked(backfillRepo);

type PostHandler = (args: {
  request: Request;
  context: {
    session: {
      session: { activeOrganizationId: string; userId: string };
      user: { id: string };
    };
  };
}) => Promise<Response>;

function getHandler(): PostHandler {
  return getRouteHandler<PostHandler>(Route, "POST", "/api/cli/import");
}

const context = {
  session: {
    session: { activeOrganizationId: CLI_TEST_ORG_ID, userId: "user-1" },
    user: { id: "user-1" },
  },
};

beforeEach(() => vi.clearAllMocks());

async function mockCurrentMemberRole(role: string) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce({
    members: [{ userId: "user-1", role }],
  } as never);
}

function callImport(body: unknown) {
  return getHandler()({
    request: new Request("http://localhost/api/cli/import", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    context,
  });
}

describe("/api/cli/import", () => {
  it("returns 403 when the current user cannot manage imports", async () => {
    await mockCurrentMemberRole("member");
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);

    const response = await callImport({ repos: ["org/repo-a"] });

    expect(response.status).toBe(403);
    expect(mockedListRepos).not.toHaveBeenCalled();
    expect(mockedBackfillRepo).not.toHaveBeenCalled();
  });

  it("returns 400 when repos list is empty", async () => {
    const response = await callImport({ repos: [] });

    expect(response.status).toBe(400);
  });

  it("returns 400 when no active GitHub installation", async () => {
    await mockCurrentMemberRole("admin");
    mockDbInstallations(mockedDb, []);

    const response = await callImport({ repos: ["org/repo-a"] });

    expect(response.status).toBe(400);
  });

  it("returns ok immediately and starts backfill in background", async () => {
    await mockCurrentMemberRole("admin");
    mockDbInstallations(mockedDb, [{ status: "active", installationId: 99 }]);
    const repo = { id: 1, full_name: "org/repo-a" } as Awaited<
      ReturnType<typeof mockedListRepos>
    >[number];
    mockedListRepos.mockResolvedValueOnce([repo]);

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

    const response = await callImport({ repos: ["org/repo-a"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockedBackfillRepo).toHaveBeenCalledWith(99, CLI_TEST_ORG_ID, repo);
  });
});
