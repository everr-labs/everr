import { expect, it, vi } from "vite-plus/test";

vi.mock("../../../../components/organization-setup", () => ({
  OrganizationSetup: () => null,
}));

import { Route } from "./organization-setup";

const options = Route.options as unknown as {
  validateSearch: { parse: (input: unknown) => { returnTo: string } };
};

it.each(["/organization-setup", "/choose-organization"])(
  "rejects setup and chooser redirect loops: %s",
  (returnTo) => {
    expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo: "/" });
  },
);

it("preserves a local destination including query parameters and fragment", () => {
  const returnTo = "/logs?service=api#results";
  expect(options.validateSearch.parse({ returnTo })).toEqual({ returnTo });
});
