import { SidebarProvider } from "@everr/ui/components/sidebar";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageNotReadyError } from "@everr/app/common/storage-readiness";

const mocks = vi.hoisted(() => ({
  githubEnabled: false,
  pathname: "/organization-setup",
  invalidate: vi.fn(),
  role: "owner",
  setActive: vi.fn(),
  organizations: [{ id: "org_1", name: "Acme" }],
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => mocks.pathname,
  useRouteContext: () => ({ githubEnabled: mocks.githubEnabled }),
  Link: forwardRef<
    HTMLAnchorElement,
    { children?: ReactNode; className?: string; to: string }
  >(function MockLink({ children, className, to, ...props }, ref) {
    return (
      <a ref={ref} href={to} className={className} {...props}>
        {children}
      </a>
    );
  }),
  useRouter: () => ({
    invalidate: mocks.invalidate,
  }),
}));

vi.mock("../data/organizations", () => ({
  createOrganization: vi.fn(),
  getOrganizationCreationOptions: vi
    .fn()
    .mockResolvedValue({ canCreateHobby: true }),
}));

vi.mock("@everr/app/lib/auth-client", () => ({
  authClient: {
    organization: { setActive: mocks.setActive },
    signOut: vi.fn(),
    useActiveOrganization: () => ({
      data: {
        id: "org_1",
        name: "Acme",
        members: [{ userId: "user_1", role: mocks.role }],
      },
    }),
    useListOrganizations: () => ({
      data: mocks.organizations,
    }),
    useSession: () => ({
      data: {
        user: {
          id: "user_1",
          email: "test@example.com",
          name: "Test User",
          image: null,
        },
      },
    }),
  },
}));

import { ConsentGate } from "@everr/app/telemetry/consent-gate";

import { layouts } from "./layouts";

function renderUserMenu(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ConsentGate initialConsent="denied">
        <SidebarProvider>
          <layouts.UserMenu />
        </SidebarProvider>
      </ConsentGate>
    </QueryClientProvider>,
  );
}

describe("User menu", () => {
  beforeEach(() => {
    mocks.role = "owner";
    mocks.githubEnabled = false;
    mocks.organizations = [{ id: "org_1", name: "Acme" }];
    mocks.invalidate.mockReset();
    mocks.setActive.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    "pending",
    "ready",
  ])("reruns the guard without waiting for dashboard retries when switching to a %s organization", async (readiness) => {
    mocks.organizations.push({ id: "pending", name: "Pending" });
    let pending = false;
    mocks.setActive.mockImplementation(async () => {
      pending = true;
      return { error: null };
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 3 } },
    });
    const queryKey = ["panel-query", "usage"];
    queryClient.setQueryData(queryKey, [{ value: 1 }]);
    const observer = new QueryObserver(queryClient, {
      queryKey,
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: async () => {
        if (pending && readiness === "pending")
          throw new StorageNotReadyError();
        return [{ value: pending ? 2 : 1 }];
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      renderUserMenu(queryClient);
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /Test User/ }));
      const pendingOrganization = await screen.findByRole("menuitem", {
        name: "Pending",
      });
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(pendingOrganization);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.setActive).toHaveBeenCalledWith({
        organizationId: "pending",
      });
      expect(mocks.invalidate).toHaveBeenCalledOnce();
      if (readiness === "ready")
        expect(queryClient.getQueryData(queryKey)).toEqual([{ value: 2 }]);
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });

  it("opens the flat menu without losing the menu group context", async () => {
    mocks.githubEnabled = true;
    const user = userEvent.setup();
    renderUserMenu();

    await user.click(screen.getByRole("button", { name: /Test User/ }));

    expect(await screen.findByText("Organization settings")).toBeVisible();
    expect(
      await screen.findByRole("menuitem", { name: "GitHub" }),
    ).toHaveAttribute("href", "/github");
    expect(screen.getByText("Account & privacy")).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Plan & Billing" }),
    ).toHaveAttribute("href", "/billing");
  });

  it("opens privacy settings from the menu and preserves the saved choice", async () => {
    const user = userEvent.setup();
    renderUserMenu();
    const open = async () => {
      await user.click(screen.getByRole("button", { name: /Test User/ }));
      expect(
        screen.queryByRole("menuitem", { name: "GitHub" }),
      ).not.toBeInTheDocument();
      await user.click(
        await screen.findByRole("menuitem", { name: "Privacy preferences" }),
      );
      expect(
        await screen.findByRole("dialog", { name: "Your Privacy" }),
      ).toBeVisible();
    };
    await open();
    expect(screen.getByRole("switch", { name: "Analytics" })).not.toBeChecked();
    await user.click(screen.getByRole("switch", { name: "Analytics" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await open();
    expect(screen.getByRole("switch", { name: "Analytics" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Deny" }));
    await open();
    expect(screen.getByRole("switch", { name: "Analytics" })).not.toBeChecked();
  });

  it("hides organization settings from ordinary members", async () => {
    mocks.role = "member";
    const user = userEvent.setup();
    renderUserMenu();

    await user.click(screen.getByRole("button", { name: /Test User/ }));

    expect(await screen.findByText("Account & privacy")).toBeVisible();
    expect(screen.queryByText("Organization settings")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Plan & Billing" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Acme" })).toBeVisible();
  });
});

// jsdom has no canvas renderer; exercise the actual welcome layout.
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

it.each([
  [true, "/organization-setup", true],
  [true, "/choose-organization", false],
  [false, "/organization-setup", false],
] as const)("shows the welcome switcher when signed in on setup (%s, %s)", async (signedIn, pathname, visible) => {
  mocks.pathname = pathname;
  mocks.organizations = [
    { id: "org_1", name: "Acme" },
    { id: "org_2", name: "Other" },
  ];
  mocks.setActive.mockClear();
  mocks.invalidate.mockClear();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <layouts.Welcome signedIn={signedIn} activeOrganizationId="org_1">
        <p>Welcome page content</p>
      </layouts.Welcome>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Welcome page content")).toBeVisible();
  if (!visible) {
    expect(
      screen.queryByRole("button", { name: "Switch organization" }),
    ).not.toBeInTheDocument();
    expect(!!screen.queryByRole("button", { name: "Log out" })).toBe(signedIn);
    return;
  }
  const user = userEvent.setup();
  const switcher = screen.getByRole("button", { name: "Switch organization" });
  expect(switcher).toHaveTextContent("Acme");
  switcher.focus();
  await user.keyboard("{ArrowDown}");
  await user.click(await screen.findByRole("menuitem", { name: "Other" }));
  expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "org_2" });
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});
