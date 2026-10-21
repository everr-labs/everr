vi.mock("@everr/app/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createFileRoute,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  googleEnabled: true,
  emailEnabled: false,
  session: null as {
    user: { id: string; name: string; email: string; emailVerified: boolean };
    session: { activeOrganizationId: null };
  } | null,
  signup: vi.fn(),
  social: vi.fn(),
  verification: vi.fn(),
  refetch: () => Promise.resolve(),
}));
// jsdom has no canvas renderer; keep the real welcome layout mounted.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
vi.mock("@everr/app/identity/client", () => ({
  authClient: {
    signUp: { email: mocks.signup },
    signIn: { social: mocks.social },
    sendVerificationEmail: mocks.verification,
    useListOrganizations: () => ({
      data: [],
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: mocks.refetch,
    }),
  },
}));
vi.mock("../../data/organizations", () => ({
  getOrganizationCreationOptions: async () => ({ canCreateHobby: true }),
}));
vi.mock("@everr/app/data/invite", async () => {
  const resolver = await import("@everr/app/data/invite-resolver");
  return {
    resolveInvitationLoader: resolver.resolveInvitationLoader,
    lookupInvitation: async () => ({
      status: "pending",
      organizationId: "pro-org",
      organizationName: "Acme Pro",
      invitedEmail: "invited@example.com",
      inviterName: "Owner",
      role: "member",
    }),
    isMemberOfOrg: async () => ({ isMember: false }),
  };
});

import { productRouteFiles, sharedRouteModules } from "@everr/app/testing/routes";

const sourceModule = (path: string) => new URL(path, import.meta.url).pathname;
const retained = new Set([
  sharedRouteModules.welcome,
  sharedRouteModules.guest,
  sharedRouteModules.signup,
  sharedRouteModules.invitation,
  sharedRouteModules.signedIn,
  sourceModule("../../routes/_welcome/_signedIn/_organization.tsx"),
  sourceModule("../../routes/_welcome/_signedIn/_organization/organization-setup.tsx"),
  sourceModule("../../routes/_welcome/_signedIn/choose-organization.tsx"),
]);
for (const path of [
  ...productRouteFiles,
  ...Object.keys(import.meta.glob("../../routes/**/*.{ts,tsx}")).map(sourceModule),
]) {
  if (retained.has(path)) continue;
  vi.doMock(path, () => {
    if (path !== sharedRouteModules.root) return { Route: createFileRoute()({}) };
    const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
      beforeLoad: () => ({
        session: mocks.session,
        googleSignInEnabled: mocks.googleEnabled,
        emailEnabled: mocks.emailEnabled,
      }),
      component: function Component() {
        const { queryClient } = Route.useRouteContext();
        return (
          <QueryClientProvider client={queryClient}>
            <Outlet />
          </QueryClientProvider>
        );
      },
    });
    return { Route };
  });
}
const { routeTree } = await import("@composition/routes");

function signUpInvitedUser() {
  mocks.session = {
    user: {
      id: "invited-user",
      name: "Invited User",
      email: "invited@example.com",
      emailVerified: false,
    },
    session: { activeOrganizationId: null },
  };
  return { error: null };
}

beforeEach(() => {
  mocks.googleEnabled = true;
  mocks.emailEnabled = false;
  mocks.session = null;
  mocks.signup.mockReset().mockImplementation(async () => signUpInvitedUser());
  mocks.social.mockReset();
  mocks.verification.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

function invitationSignupRouter() {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ["/invite/invitation-123"],
    }),
    context: { queryClient },
  });
}

it.each([
  { provider: "email", emailEnabled: false },
  { provider: "google", emailEnabled: false },
  { provider: "email", emailEnabled: true },
])(
  "returns an invited $provider signup to acceptance (email enabled: $emailEnabled)",
  async ({ provider, emailEnabled }) => {
    mocks.emailEnabled = emailEnabled;
    mocks.googleEnabled = provider === "google";
    const router = invitationSignupRouter();
    mocks.social.mockImplementation(async (options) => {
      signUpInvitedUser();
      await router.navigate({ href: options.callbackURL });
      return { error: null };
    });
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    await screen.findByRole("heading", { name: "Create your account" });
    expect(screen.getByLabelText("Email")).toHaveValue("invited@example.com");
    if (provider === "email") {
      expect(screen.queryByRole("button", { name: "Sign up with Google" })).toBeNull();
      expect(screen.queryByText("or")).toBeNull();
      await user.type(screen.getByLabelText("Name"), "Invited User");
      await user.type(screen.getByLabelText("Password"), "test-password-123");
      await user.click(screen.getByRole("button", { name: "Sign up" }));
    } else {
      await user.click(screen.getByRole("button", { name: "Sign up with Google" }));
    }
    if (emailEnabled) {
      await screen.findByRole("heading", { name: "Verify your email" });
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Send verification email" }));
      expect(mocks.verification).toHaveBeenCalledWith({
        email: "invited@example.com",
        callbackURL: "/invite/invitation-123",
      });
      expect(await screen.findByRole("status")).toHaveTextContent("Check your inbox");
      if (!mocks.session) throw new Error("Missing invited session");
      mocks.session.user.emailVerified = true;
      await router.invalidate();
    }
    expect(await screen.findByRole("button", { name: "Accept" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Decline" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/invite/invitation-123");
    expect(screen.queryByRole("heading", { name: "Let's get you settled" })).toBeNull();
    expect(screen.queryByLabelText("Organization name")).toBeNull();
  },
);

vi.mock("../../organization-provisioning/actions", () => ({
  completeOrganizationSetup: vi.fn().mockResolvedValue(undefined),
  getOrganizationProvisioningStatus: vi.fn().mockResolvedValue(null),
  retryOrganizationProvisioning: vi.fn(),
}));
