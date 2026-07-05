import { getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteCurrentUserAccount", () => {
  it("deletes the current user without deleting the active organization by default", async () => {
    await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });

    expect(auth.api.getFullOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
    expect(auth.api.deleteUser).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {},
    });
  });

  it("deletes the active organization first when an org owner chooses that option", async () => {
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
    expect(vi.mocked(auth.api.deleteOrganization).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(auth.api.deleteUser).mock.invocationCallOrder[0],
    );
  });

  it("rejects organization deletion when the current user is not an org owner", async () => {
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

  it("uses the current request headers for Better Auth operations", async () => {
    await deleteCurrentUserAccount({ data: { confirmation: "DELETE" } });

    expect(getRequestHeaders).toHaveBeenCalled();
  });
});
