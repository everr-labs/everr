// @vitest-environment node
import { expect, it } from "vitest";
import { server } from "./runtime";

it.each([
  { pathname: "/setup", redirect: { to: "/" } },
  { pathname: "/", redirect: undefined },
  { pathname: "/auth/sign-up", redirect: undefined },
])("resolves the cloud entry policy for $pathname", async ({
  pathname,
  redirect,
}) => {
  expect(await server.getEntryRedirect(pathname)).toEqual(redirect);
});
