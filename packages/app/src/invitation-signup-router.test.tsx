import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as {
    user: { id: string; name: string; email: string };
    session: { activeOrganizationId: null };
  } | null,
  signup: vi.fn(),
  social: vi.fn(),
  refetch: () => Promise.resolve(),
}));
vi.mock("@/routes/_auth/-components/ascii-logo", () => ({
  AsciiLogo: () => null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: { email: mocks.signup },
    signIn: { social: mocks.social },
    useListOrganizations: () => ({
      data: [],
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: mocks.refetch,
    }),
  },
}));
vi.mock("@/data/auth", () => ({ getActiveOrganization: () => null }));
vi.mock("@/data/organizations", () => ({
  getOrganizationCreationOptions: async () => ({ canCreateHobby: true }),
}));
vi.mock("@/data/invite", async () => {
  const resolver = await import("@/data/invite-resolver");
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

import { Route as authRoute } from "@/routes/_auth";
import { Route as guestRoute } from "@/routes/_auth/_guest";
import { Route as signupRoute } from "@/routes/_auth/_guest/auth/sign-up";
import { Route as onboardingRoute } from "@/routes/_auth/_onboarding";
import { Route as chooseRoute } from "@/routes/_auth/_onboarding/choose-organization";
import { Route as setupRoute } from "@/routes/_auth/_onboarding/organization-setup";
import { Route as invitationRoute } from "@/routes/_auth/invite.$invitationId";

function signUpInvitedUser() {
  mocks.session = {
    user: {
      id: "invited-user",
      name: "Invited User",
      email: "invited@example.com",
    },
    session: { activeOrganizationId: null },
  };
  return { error: null };
}

beforeEach(() => {
  mocks.session = null;
  mocks.signup.mockReset().mockImplementation(async () => signUpInvitedUser());
  mocks.social.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

function invitationSignupRouter() {
  const queryClient = new QueryClient();
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    beforeLoad: () => ({ session: mocks.session }),
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const authentication = createRoute({
    getParentRoute: () => root,
    id: "_auth",
    component: authRoute.options.component,
  });
  const guest = createRoute({
    getParentRoute: () => authentication,
    id: "_guest",
    beforeLoad: (options) => guestRoute.options.beforeLoad?.(options as never),
    component: guestRoute.options.component,
  });
  const signup = createRoute({
    getParentRoute: () => guest,
    path: "/auth/sign-up",
    validateSearch: signupRoute.options.validateSearch,
    component: signupRoute.options.component,
  });
  const onboarding = createRoute({
    getParentRoute: () => authentication,
    id: "_onboarding",
    beforeLoad: (options) =>
      onboardingRoute.options.beforeLoad?.(options as never),
  });
  const setup = createRoute({
    getParentRoute: () => onboarding,
    path: "/organization-setup",
    validateSearch: setupRoute.options.validateSearch,
    beforeLoad: (options) => setupRoute.options.beforeLoad?.(options as never),
    component: setupRoute.options.component,
  });
  const choose = createRoute({
    getParentRoute: () => onboarding,
    path: "/choose-organization",
    validateSearch: chooseRoute.options.validateSearch,
    component: chooseRoute.options.component,
  });
  const invitation = createRoute({
    getParentRoute: () => authentication,
    path: "/invite/$invitationId",
    loader: (options) => {
      const loader = invitationRoute.options.loader;
      if (typeof loader !== "function")
        throw new Error("Expected invite loader");
      return loader(options as never);
    },
    component: invitationRoute.options.component,
  });
  return createRouter({
    routeTree: root.addChildren([
      authentication.addChildren([
        guest.addChildren([signup]),
        onboarding.addChildren([setup, choose]),
        invitation,
      ]),
    ]),
    history: createMemoryHistory({
      initialEntries: ["/invite/invitation-123"],
    }),
    context: { queryClient },
  });
}

it.each([
  "email",
  "google",
])("returns an invited %s signup to Accept or Decline without organization creation", async (provider) => {
  const router = invitationSignupRouter();
  mocks.social.mockImplementation(async (options) => {
    signUpInvitedUser();
    await router.navigate({ href: options.newUserCallbackURL });
    return { error: null };
  });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Create account" }),
  );
  await screen.findByRole("heading", { name: "Create your account" });
  expect(screen.getByLabelText("Email")).toHaveValue("invited@example.com");
  if (provider === "email") {
    await user.type(screen.getByLabelText("Name"), "Invited User");
    await user.type(screen.getByLabelText("Password"), "test-password-123");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
  } else {
    await user.click(
      screen.getByRole("button", { name: "Sign up with Google" }),
    );
  }
  expect(await screen.findByRole("button", { name: "Accept" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Decline" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/invite/invitation-123");
  expect(
    screen.queryByRole("heading", { name: "Let's get you settled" }),
  ).toBeNull();
  expect(screen.queryByLabelText("Organization name")).toBeNull();
});

vi.mock("@/data/organization-provisioning", () => ({
  getOrganizationProvisioningStatus: vi.fn().mockResolvedValue(null),
  retryOrganizationProvisioning: vi.fn(),
}));
