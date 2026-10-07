import { expect, it, vi } from "vitest";

vi.mock("@/components/organization-setup", () => ({
  OrganizationSetup: () => null,
}));

import { Route } from "./organization-setup";

const options = Route.options as unknown as {
  validateSearch: { parse: (input: unknown) => { returnTo: string } };
  beforeLoad: (input: {
    context: { clickhouseReady: boolean };
    search: { returnTo: string };
  }) => void;
};

it.each([
  "https://example.com",
  "//example.com",
  "/\\example.com",
  "/\n/example.com",
  "/organization-setup",
])("rejects unsafe or looping return destinations: %s", (returnTo) => {
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo: "/" });
});

it("preserves a local destination including query parameters and fragment", () => {
  const returnTo = "/logs?service=api#results";
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo });
});

it("stays on setup while pending and returns to the requested page when ready", () => {
  const search = { returnTo: "/logs?service=api" };
  expect(() =>
    options.beforeLoad({ context: { clickhouseReady: false }, search }),
  ).not.toThrow();
  try {
    options.beforeLoad({ context: { clickhouseReady: true }, search });
    throw new Error("Expected a redirect");
  } catch (error) {
    expect(error).toMatchObject({
      options: { href: search.returnTo, replace: true },
    });
  }
});
