import { productRouteFiles, sharedRouteModules } from "@everr/app/testing/routes";
import { QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: {
    user: { id: "user" },
    session: { activeOrganizationId: "org" as string | null },
  } as {
    user: { id: string };
    session: { activeOrganizationId: string | null };
  } | null,
  createdOrganizationId: null as string | null,
  ready: true,
  suspended: false,
  member: true,
  accessError: null as Error | null,
  membershipReads: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@everr/app/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(async () => {
    state.membershipReads();
    if (state.accessError) throw state.accessError;
    return state.member
      ? {
          status: "available",
          organization: {
            id: "org",
            metadata: JSON.stringify({ clickhouseReady: state.ready }),
          },
          entryRedirect:
            state.createdOrganizationId === "org" ? { to: "/organization-setup" } : undefined,
        }
      : { status: "missing" };
  }),
}));
vi.mock("@everr/app/data/product", () => ({
  getActiveOrgPolicy: vi.fn(async () => ({
    access: state.suspended ? "suspended" : "enabled",
  })),
}));

const sourceModule = (path: string) => new URL(path, import.meta.url).pathname;
const guards = new Set([
  sharedRouteModules.authenticated,
  sharedRouteModules.organization,
  sharedRouteModules.access,
  sharedRouteModules.provisioned,
  sharedRouteModules.signedIn,
  sourceModule("../../routes/_welcome/_signedIn/_organization.tsx"),
]);
for (const path of [
  ...productRouteFiles,
  ...Object.keys(import.meta.glob("../../routes/**/*.{ts,tsx}")).map(
    (path) => new URL(path, import.meta.url).pathname,
  ),
]) {
  if (guards.has(path)) continue;
  vi.doMock(path, () => ({
    Route:
      path === sharedRouteModules.root
        ? createRootRoute({
            beforeLoad: () => ({
              session: state.session,
            }),
          })
        : createFileRoute()({
            staticData: path === sharedRouteModules.device ? { authEntry: "/auth/sign-up" } : {},
            loader: ({ context }) =>
              state.load(path, (context as { organization?: { id: string } }).organization),
          }),
  }));
}
const { routeTree } = await import("@composition/routes");

beforeEach(() => {
  state.session = {
    user: { id: "user" },
    session: { activeOrganizationId: "org" },
  };
  state.createdOrganizationId = null;
  state.member = true;
  state.accessError = null;
  state.ready = true;
  state.suspended = false;
  vi.clearAllMocks();
});
async function open(href: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [href] }),
  });
  await router.load();
  return router;
}

it("blocks data loaders and preserves the entire destination for pending organizations", async () => {
  state.ready = false;
  const router = await open("/logs?service=api#results");
  expect(router.state.location.pathname).toBe("/organization-pending");
  expect(router.state.location.search.returnTo).toBe("/logs?service=api#results");
  expect(state.load.mock.calls.some(([path]) => path === sharedRouteModules.logs)).toBe(false);
});
it("redirects suspended organizations before loading telemetry", async () => {
  state.suspended = true;
  const router = await open("/logs?service=api");
  expect(router.state.location.pathname).toBe("/billing/suspended");
  expect(state.load.mock.calls.some(([path]) => path === sharedRouteModules.logs)).toBe(false);
});
it.each([
  "/billing",
  "/billing/suspended",
  "/checkout/success?checkout_id=one",
  "/device?user_code=ABCD",
])("keeps %s available while provisioning and subscription access are blocked", async (href) => {
  state.ready = false;
  state.suspended = true;
  const router = await open(href);
  expect(router.state.location.pathname).toBe(href.split("?")[0]);
});
it("keeps account settings accessible without an organization", async () => {
  state.session = {
    user: { id: "user" },
    session: { activeOrganizationId: null },
  };
  state.member = false;
  expect((await open("/account")).state.location.pathname).toBe("/account");
  expect(state.membershipReads).not.toHaveBeenCalled();
});
it("forces fast automatic creation through setup and resumes data routes after completion", async () => {
  state.createdOrganizationId = "org";
  const router = await open("/logs?service=api#results");
  expect(router.state.location.pathname).toBe("/organization-setup");
  expect(router.state.location.search.returnTo).toBe("/logs?service=api#results");
  state.createdOrganizationId = null;
  await router.navigate({ href: "/logs?service=api#results" });
  expect(router.state.location.pathname).toBe("/logs");
});
it("allows invitations before organization selection and after signup", async () => {
  state.session = null;
  const router = await open("/invite/one");
  expect(router.state.location.pathname).toBe("/invite/one");
  state.session = {
    user: { id: "invited" },
    session: { activeOrganizationId: null },
  };
  await router.invalidate();
  expect(router.state.location.pathname).toBe("/invite/one");
});
it("sends a fresh device login to signup with its code preserved", async () => {
  state.session = null;
  const router = await open("/device?user_code=ABCD");
  expect(router.state.location.pathname).toBe("/auth/sign-up");
  expect(router.state.location.search.redirect).toBe("/device?user_code=ABCD");
});
it("keeps signed-in creation accessible without an organization", async () => {
  state.session = {
    user: { id: "user" },
    session: { activeOrganizationId: null },
  };
  expect((await open("/create-organization?returnTo=%2Flogs")).state.location.pathname).toBe(
    "/create-organization",
  );
});

it("passes verified organization context to data loaders", async () => {
  await open("/logs");
  expect(state.membershipReads).toHaveBeenCalledOnce();
  expect(state.load).toHaveBeenCalledWith(
    sharedRouteModules.logs,
    expect.objectContaining({ id: "org" }),
  );
});
it("preserves the destination when no organization is selected", async () => {
  state.session = {
    user: { id: "user" },
    session: { activeOrganizationId: null },
  };
  const router = await open("/logs?service=api#results");
  expect(router.state.location.pathname).toBe("/choose-organization");
  expect(router.state.location.search.returnTo).toBe("/logs?service=api#results");
  expect(state.membershipReads).not.toHaveBeenCalled();
});
it("redirects revoked membership before running data loaders", async () => {
  state.member = false;
  const router = await open("/logs?service=api#results");
  expect(router.state.location.pathname).toBe("/choose-organization");
  expect(router.state.location.search.returnTo).toBe("/logs?service=api#results");
  expect(state.load.mock.calls.some(([path]) => path === sharedRouteModules.logs)).toBe(false);
});
it("does not apply another organization's creation continuation", async () => {
  state.createdOrganizationId = "another-org";
  expect((await open("/logs")).state.location.pathname).toBe("/logs");
});
it("keeps organization lookup failures visible instead of redirecting", async () => {
  state.accessError = new Error("Organization database unavailable");
  const router = await open("/logs");
  expect(router.state.location.pathname).toBe("/logs");
  expect(router.state.matches.some((match) => match.error === state.accessError)).toBe(true);
  expect(state.load.mock.calls.some(([path]) => path === sharedRouteModules.logs)).toBe(false);
});
