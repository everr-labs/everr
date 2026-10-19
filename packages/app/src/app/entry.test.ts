// @vitest-environment node
import { expect, it, vi } from "vitest";
import { server } from "./composition/server";
import { getInstallation } from "./installation.server";

vi.mock("./installation.server", () => ({ getInstallation: vi.fn() }));

it.each([
  { installed: false, pathname: "/", redirect: { href: "/setup" } },
  { installed: false, pathname: "/setup", redirect: undefined },
  { installed: true, pathname: "/", redirect: undefined },
  { installed: true, pathname: "/setup", redirect: { to: "/" } },
])("resolves $pathname with installed=$installed", async ({
  installed,
  pathname,
  redirect,
}) => {
  vi.mocked(getInstallation).mockResolvedValueOnce(
    installed ? { id: "workspace" } : null,
  );
  expect(await server.getEntryRedirect(pathname)).toEqual(redirect);
});

it("propagates installation lookup failures", async () => {
  vi.mocked(getInstallation).mockRejectedValueOnce(
    new Error("installation unavailable"),
  );
  await expect(server.getEntryRedirect("/")).rejects.toThrow(
    "installation unavailable",
  );
});
