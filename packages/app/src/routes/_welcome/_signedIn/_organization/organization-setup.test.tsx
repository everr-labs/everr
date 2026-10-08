import { expect, it, vi } from "vitest";

vi.mock("@/components/organization-setup", () => ({
  OrganizationSetup: () => null,
}));

import { Route } from "./organization-setup";

const options = Route.options as unknown as {
  validateSearch: { parse: (input: unknown) => { returnTo: string } };
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

it("preserves a local destination including query parameters and fragment", () => {
  const returnTo = "/logs?service=api#results";
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo });
});
