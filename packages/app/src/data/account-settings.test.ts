import { getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import { deleteCurrentUserAccount } from "./account-settings";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(() => new Headers({ cookie: "session=test" })),
}));

type OrgMember = {
  userId: string;
  role: string;
};

function activeOrg(members: OrgMember[]) {
  return {
    id: "test_org",
    name: "Test Org",
    members,
  };
}

function orgSummary(id: string, name: string) {
  return { id, name, slug: id, createdAt: new Date() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.listOrganizations).mockResolvedValue([]);
});

describe("deleteCurrentUserAccount", () => {
  it("deletes the current user without deleting the active organization by default", async () => {
    await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });

    expect(auth.api.listOrganizations).toHaveBeenCalledWith({
      headers: expect.any(Headers),
    });
    expect(auth.api.getFullOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {},
    });
  });

  it("deletes the active organization first when an org owner chooses that option", async () => {
    vi.mocked(auth.api.listOrganizations).mockResolvedValueOnce([
      orgSummary("test_org", "Test Org"),
    ] as never);
    vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce(
      activeOrg([{ userId: "test_user", role: "owner" }]) as never,
    );

    await deleteCurrentUserAccount({
      data: { confirmation: "DELETE", deleteOrganization: true },
    });

    expect(auth.api.getFullOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: { organizationId: "test_org" },
    });
    expect(auth.api.deleteOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { organizationId: "test_org" },
    });
    expect(auth.api.deleteUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {},
    });
    expect(
      vi.mocked(auth.api.deleteOrganization).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(auth.api.deleteUser).mock.invocationCallOrder[0]);
  });

  it("rejects organization deletion when the current user is not an org owner", async () => {
    vi.mocked(auth.api.listOrganizations).mockResolvedValueOnce([
      orgSummary("test_org", "Test Org"),
    ] as never);
    vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce(
      activeOrg([{ userId: "test_user", role: "admin" }]) as never,
    );

    await expect(
      deleteCurrentUserAccount({
        data: { confirmation: "DELETE", deleteOrganization: true },
      }),
    ).rejects.toThrow("Only organization owners can delete the organization");

    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteUser).not.toHaveBeenCalled();
  });

  it("blocks deletion when the user is the sole owner of another organization", async () => {
    vi.mocked(auth.api.listOrganizations).mockResolvedValueOnce([
      orgSummary("test_org", "Test Org"),
      orgSummary("other_org", "Other Org"),
    ] as never);
    vi.mocked(auth.api.getFullOrganization)
      .mockResolvedValueOnce(
        activeOrg([
          { userId: "test_user", role: "owner" },
          { userId: "co_owner", role: "owner" },
        ]) as never,
      )
      .mockResolvedValueOnce({
        ...activeOrg([{ userId: "test_user", role: "owner" }]),
        id: "other_org",
        name: "Other Org",
      } as never);

    await expect(
      deleteCurrentUserAccount({ data: { confirmation: "DELETE" } }),
    ).rejects.toThrow("You are the only owner of: Other Org");

    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteUser).not.toHaveBeenCalled();
  });

  it("allows deletion when another organization has a second owner", async () => {
    vi.mocked(auth.api.listOrganizations).mockResolvedValueOnce([
      orgSummary("other_org", "Other Org"),
    ] as never);
    vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce({
      ...activeOrg([
        { userId: "test_user", role: "owner" },
        { userId: "co_owner", role: "owner" },
      ]),
      id: "other_org",
      name: "Other Org",
    } as never);

    await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });

    expect(auth.api.deleteUser).toHaveBeenCalled();
  });

  it("uses the current request headers for Better Auth operations", async () => {
    await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });

    expect(getRequestHeaders).toHaveBeenCalled();
  });
});
