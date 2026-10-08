import { expect, it, vi } from "vitest";

vi.mock("@/components/organization-setup", () => ({
  OrganizationSetup: () => null,
}));
vi.mock("@/data/auth", () => ({ getActiveOrganization: vi.fn() }));

import { getActiveOrganization } from "@/data/auth";

import { Route } from "./organization-setup";

const options = Route.options as unknown as {
  validateSearch: { parse: (input: unknown) => { returnTo: string } };
  beforeLoad: (args: {
    context: { session: { session: { activeOrganizationId: string | null } } };
    search: { returnTo: string };
  }) => Promise<unknown>;
};

it.each([
  "https://example.com",
  "//example.com",
  "/\\example.com",
  "/\n/example.com",
  "/organization-setup",
  "/choose-organization",
])("rejects unsafe or looping return destinations: %s", (returnTo) => {
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo: "/" });
});

function openSetup(activeOrganizationId: string | null) {
  return options.beforeLoad({
    context: { session: { session: { activeOrganizationId } } },
    search: { returnTo: "/logs?service=api" },
  });
}

it("redirects missing selection to the chooser while staying inside the auth layout", async () => {
  await expect(openSetup(null)).rejects.toMatchObject({
    options: {
      to: "/choose-organization",
      search: { returnTo: "/logs?service=api" },
    },
  });
});

it("verifies membership without bypassing the provisioning view for an already-ready organization", async () => {
  vi.mocked(getActiveOrganization).mockResolvedValue({
    id: "new",
    clickhouseReady: true,
  } as never);
  await expect(openSetup("new")).resolves.toBeUndefined();
});

it("redirects revoked membership to the chooser", async () => {
  vi.mocked(getActiveOrganization).mockRejectedValue(
    new Error("User is not a member of the organization"),
  );
  await expect(openSetup("new")).rejects.toMatchObject({
    options: { to: "/choose-organization" },
  });
});

it("keeps infrastructure errors visible", async () => {
  vi.mocked(getActiveOrganization).mockRejectedValue(
    new Error("Organization database unavailable"),
  );
  await expect(openSetup("new")).rejects.toThrow("database unavailable");
});

it("preserves a local destination including query parameters and fragment", () => {
  const returnTo = "/logs?service=api#results";
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo });
});
