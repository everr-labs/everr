import { getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import { createOrganization } from "./organizations";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(() => new Headers({ cookie: "session=test" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrganization", () => {
  it("creates an organization for the authenticated user", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);

    await expect(
      createOrganization({ data: { organizationName: "  Acme  " } }),
    ).resolves.toEqual({ id: "org_new", name: "Acme" });

    expect(auth.api.createOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        name: "Acme",
        slug: expect.stringMatching(/^org-/),
      },
    });
    expect(getRequestHeaders).toHaveBeenCalled();
  });

  it("rejects an invalid name before creating anything", async () => {
    await expect(
      createOrganization({ data: { organizationName: " " } }),
    ).rejects.toThrow();

    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
});
