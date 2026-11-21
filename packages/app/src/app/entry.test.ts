import { expect, it, vi } from "vite-plus/test";
import { getEntryRedirect } from "./entry";
import { getEntryState } from "./entry-state";
import { getInstallation } from "./installation.server";

vi.mock("./installation.server", () => ({ getInstallation: vi.fn() }));
vi.mock("#app/db/client.ts", () => ({ db: {} }));

it.each([
  { setupRequired: true, pathname: "/", redirect: { href: "/setup" } },
  { setupRequired: true, pathname: "/logs", redirect: { href: "/setup" } },
  { setupRequired: true, pathname: "/setup", redirect: undefined },
  { setupRequired: false, pathname: "/", redirect: undefined },
  { setupRequired: false, pathname: "/setup", redirect: { to: "/" } },
])(
  "resolves $pathname with setupRequired=$setupRequired",
  ({ setupRequired, pathname, redirect }) => {
    expect(getEntryRedirect({ setupRequired }, pathname)).toEqual(redirect);
  },
);

it.each([
  { installation: null, setupRequired: true },
  { installation: { id: "workspace" }, setupRequired: false },
])("requires setup until the installation exists", async ({ installation, setupRequired }) => {
  vi.mocked(getInstallation).mockResolvedValueOnce(installation);
  expect(await getEntryState()).toEqual({ setupRequired });
});

it("propagates installation lookup failures", async () => {
  vi.mocked(getInstallation).mockRejectedValueOnce(new Error("installation unavailable"));
  await expect(getEntryState()).rejects.toThrow("installation unavailable");
});
