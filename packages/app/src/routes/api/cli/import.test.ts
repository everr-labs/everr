import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import {
  backfillRepo,
  listInstallationRepos,
} from "@/server/github-events/backfill";
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
  context: { session: { session: { activeOrganizationId: string } } };
}) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for /api/cli/import.");
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
    mockDbInstallations([]);

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
    mockDbInstallations([{ status: "active", installationId: 99 }]);
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
