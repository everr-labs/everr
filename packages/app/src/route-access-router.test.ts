import { QueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { beforeEach, expect, it, vi } from "vitest";

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
  load: vi.fn(),
}));
vi.mock("@/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(async () =>
    state.member
      ? {
          status: "available",
          organization: {
            id: "org",
            metadata: JSON.stringify({ clickhouseReady: state.ready }),
          },
        }
      : { status: "missing" },
  ),
}));
vi.mock("@/data/billing", () => ({
  getActiveOrgAppAccess: vi.fn(async () => ({
    appState: state.suspended ? "suspended" : "hobby",
  })),
}));

const guards = new Set([
  "./routes/_authenticated.tsx",
  "./routes/_authenticated/_organization.tsx",
  "./routes/_authenticated/_organization/_dashboard/_appAccess.tsx",
  "./routes/_authenticated/_organization/_dashboard/_appAccess/_provisioned.tsx",
  "./routes/_welcome/_signedIn.tsx",
  "./routes/_welcome/_signedIn/_organization.tsx",
]);
for (const path of Object.keys(import.meta.glob("./routes/**/*.{ts,tsx}"))) {
  if (guards.has(path)) continue;
  vi.doMock(path, () => ({
    Route:
      path === "./routes/__root.tsx"
        ? createRootRoute({
            beforeLoad: () => ({
              session: state.session,
              createdOrganizationId: state.createdOrganizationId,
            }),
          })
        : createFileRoute()({
            staticData: path.endsWith("/device.tsx")
              ? { authEntry: "/auth/sign-up" }
              : {},
            loader: () => state.load(path),
          }),
  }));
}
const { routeTree } = await import("./routeTree.gen");

beforeEach(() => {
  state.session = {
    user: { id: "user" },
    session: { activeOrganizationId: "org" },
  };
  state.createdOrganizationId = null;
  state.member = true;
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
  expect(router.state.location.search.returnTo).toBe(
    "/logs?service=api#results",
  );
  expect(
    state.load.mock.calls.some(([path]) => path.endsWith("/_explore/logs.tsx")),
  ).toBe(false);
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
});
it("forces fast automatic creation through setup and resumes data routes after completion", async () => {
  state.createdOrganizationId = "org";
  const router = await open("/logs?service=api#results");
  expect(router.state.location.pathname).toBe("/organization-setup");
  expect(router.state.location.search.returnTo).toBe(
    "/logs?service=api#results",
  );
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
  expect(
    (await open("/create-organization?returnTo=%2Flogs")).state.location
      .pathname,
  ).toBe("/create-organization");
});
