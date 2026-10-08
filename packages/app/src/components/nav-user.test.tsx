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
import { ClickhouseProvisioningPendingError } from "@/common/clickhouse-provisioning";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  openConsentSettings: vi.fn(),
  role: "owner",
  setActive: vi.fn(),
  organizations: [{ id: "org_1", name: "Acme" }],
}));

vi.mock("@tanstack/react-router", () => ({
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

vi.mock("@/data/organizations", () => ({
  createOrganization: vi.fn(),
  getOrganizationCreationOptions: vi
    .fn()
    .mockResolvedValue({ canCreateHobby: true }),
}));

vi.mock("@/lib/auth-client", () => ({
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

vi.mock("@/telemetry/consent-gate", () => ({
  useOpenConsentSettings: () => mocks.openConsentSettings,
}));

import { NavUser } from "./nav-user";

describe("NavUser", () => {
  beforeEach(() => {
    mocks.role = "owner";
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
          throw new ClickhouseProvisioningPendingError();
        return [{ value: pending ? 2 : 1 }];
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <SidebarProvider>
            <NavUser />
          </SidebarProvider>
        </QueryClientProvider>,
      );
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
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <NavUser />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Test User/ }));

    expect(await screen.findByText("Organization settings")).toBeVisible();
    expect(screen.getByText("Account & privacy")).toBeVisible();
    const downloadItem = screen.getByRole("menuitem", {
      name: "Download App",
    });
    expect(downloadItem.querySelector(".sr-only")).toBeNull();
    expect(screen.queryByText("Billing details")).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Plan & Billing" }),
    ).toHaveAttribute("href", "/billing");
  });

  it("hides organization settings from ordinary members", async () => {
    mocks.role = "member";
    const user = userEvent.setup();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <NavUser />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Test User/ }));

    expect(await screen.findByText("Account & privacy")).toBeVisible();
    expect(screen.queryByText("Organization settings")).not.toBeInTheDocument();
  });
});
