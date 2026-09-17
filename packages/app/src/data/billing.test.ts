import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  confirm: vi.fn(),
  portal: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ middleware: () => ({ server: () => ({}) }) }),
  createServerFn: () => {
    const chain = {
      middleware: () => Object.assign(() => chain, chain),
      inputValidator: () => chain,
      handler:
        (
          fn: (args: {
            data: unknown;
            context: { orgId: string; session: { user: { id: string } } };
          }) => unknown,
        ) =>
        (args?: { data?: unknown }) =>
          fn({
            data: args?.data,
            context: { orgId: "org", session: { user: { id: "owner" } } },
          }),
    };
    return Object.assign(() => chain, chain);
  },
}));
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.example", POLAR_PRO_PRODUCT_ID: "pro" },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/serverFn", () => ({ requireOrgMiddleware: {} }));
vi.mock("@/lib/auth.server", () => ({ auth: { api: {} } }));
vi.mock("@/lib/billing-data.server", () => ({}));
vi.mock("@/lib/billing/server", () => ({
  billing: {
    startUpgradeCheckout: mocks.start,
    confirmUpgradeCheckout: mocks.confirm,
    openPortal: mocks.portal,
  },
}));

import {
  confirmOrgCheckout,
  getOrgPortalUrl,
  startOrgCheckout,
} from "./billing";

beforeEach(() => vi.resetAllMocks());
it("passes the authenticated org and user to upgrade", async () => {
  await startOrgCheckout({ data: { slug: "pro" } });
  expect(mocks.start).toHaveBeenCalledWith("org", "owner");
});
it("scopes confirmation to the authenticated org and user", async () => {
  await confirmOrgCheckout({ data: { checkoutId: "checkout" } });
  expect(mocks.confirm).toHaveBeenCalledWith("org", "owner", "checkout");
});
it("scopes portal access to the authenticated org and user", async () => {
  await getOrgPortalUrl();
  expect(mocks.portal).toHaveBeenCalledWith("org", "owner");
});
