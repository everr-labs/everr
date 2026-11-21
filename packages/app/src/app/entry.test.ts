import { expect, it, vi } from "vite-plus/test";
import { getEntryRedirect } from "./entry";
import { getInstallation } from "./installation.server";

vi.mock("./installation.server", () => ({ getInstallation: vi.fn() }));

it.each([
  { installed: false, pathname: "/", redirect: { href: "/setup" } },
  { installed: false, pathname: "/setup", redirect: undefined },
  { installed: true, pathname: "/", redirect: undefined },
  { installed: true, pathname: "/setup", redirect: { to: "/" } },
])("resolves $pathname with installed=$installed", async ({ installed, pathname, redirect }) => {
  vi.mocked(getInstallation).mockResolvedValueOnce(installed ? { id: "workspace" } : null);
  expect(await getEntryRedirect(pathname)).toEqual(redirect);
});

it("propagates installation lookup failures", async () => {
  vi.mocked(getInstallation).mockRejectedValueOnce(new Error("installation unavailable"));
  await expect(getEntryRedirect("/")).rejects.toThrow("installation unavailable");
});
