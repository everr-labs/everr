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
  context: {
    session: { userId: string; organizationId: string; tenantId: number };
  };
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
