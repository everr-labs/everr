import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github-install-state", () => ({
  parseInstallState: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  githubInstallationOrganizations: {
    githubInstallationId: "github_installation_id",
    organizationId: "organization_id",
    status: "status",
    updatedAt: "updated_at",
  },
}));

import { db } from "@/db/client";
import { parseInstallState } from "@/lib/github-install-state";
import { Route } from "./callback";

const mockedParseInstallState = vi.mocked(parseInstallState);

function getHandler() {
  const routeOptions = Route.options as unknown as {
    server?: {
      handlers?: {
        GET?: (args: { request: Request }) => Promise<Response>;
      };
    };
  };

  const handler = routeOptions.server?.handlers?.GET;
  if (!handler) {
    throw new Error("Missing GET handler for install callback route.");
  }

  return handler as (args: { request: Request }) => Promise<Response>;
}

function mockDbExistingLink(link: {
  githubInstallationId: number;
  organizationId: string;
}) {
  const limit = vi.fn().mockResolvedValue([link]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
}

function mockDbNoExistingLink() {
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
}

async function mockBetterAuthSession(session: unknown) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(session as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedParseInstallState.mockReturnValue({
    userId: "user_1",
    organizationId: "org_1",
    exp: Math.floor(Date.now() / 1000) + 60,
  });
});

describe("/api/github/install/callback", () => {
  it("redirects with already_linked when installation belongs to another org", async () => {
    await mockBetterAuthSession({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_1" },
    });
    mockDbExistingLink({
      githubInstallationId: 123,
      organizationId: "org_other",
    });

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/github/install/callback?installation_id=123&state=ok",
      ),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/?github_install=error&reason=already_linked",
    );
  });

  it("treats an existing link for the same org as a successful reactivation", async () => {
    await mockBetterAuthSession({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_1" },
    });
    mockDbExistingLink({
      githubInstallationId: 123,
      organizationId: "org_1",
    });

    const where = vi.fn();
    const set = vi.fn().mockReturnValue({ where });
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/github/install/callback?installation_id=123&state=ok",
      ),
    });

    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("inserts a new link when installation does not exist yet", async () => {
    await mockBetterAuthSession({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_1" },
    });
    mockDbNoExistingLink();

    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const handler = getHandler();
    const response = await handler({
      request: new Request(
        "http://localhost/api/github/install/callback?installation_id=123&state=ok",
      ),
    });

    expect(response.status).toBe(200);
    expect(values).toHaveBeenCalledWith({
      githubInstallationId: 123,
      organizationId: "org_1",
      status: "active",
    });
  });
});
