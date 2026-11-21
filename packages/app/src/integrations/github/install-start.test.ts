import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocked = vi.hoisted(() => ({
  suspended: vi.fn(),
}));

vi.mock("./configuration", () => ({
  getGithubConfiguration: () => ({ GITHUB_APP_INSTALL_URL: "https://github.test/install" }),
}));
vi.mock("#app/lib/session.server.ts", () => ({
  getSession: () =>
    Promise.resolve({ user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } }),
}));
vi.mock("#app/identity/server.ts", () => ({
  auth: { api: { getActiveMemberRole: () => Promise.resolve({ role: "owner" }) } },
}));
vi.mock("#app/lib/github-install-state.ts", () => ({ createInstallState: () => "state" }));
vi.mock("#app/lib/org-session.server.ts", () => ({ isOrganizationSuspended: mocked.suspended }));

import { handleInstallStart } from "./install-start";

const start = () => handleInstallStart(new Request("https://everr.test/api/github/install/start"));

beforeEach(() => {
  mocked.suspended.mockReset();
});

it("sends an admin of an active organization to GitHub", async () => {
  mocked.suspended.mockResolvedValue(false);

  const response = await start();

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toMatch(/^https:\/\/github\.test\/install/);
});

it("refuses to connect GitHub to a suspended organization", async () => {
  mocked.suspended.mockResolvedValue(true);

  const response = await start();

  expect(response.status).toBe(403);
  expect(mocked.suspended).toHaveBeenCalledWith("org-1");
});
