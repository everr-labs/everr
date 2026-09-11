import { SidebarProvider } from "@everr/ui/components/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  navigate: vi.fn(),
  openConsentSettings: vi.fn(),
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
    navigate: mocks.navigate,
  }),
}));

vi.mock("@/data/billing", () => ({
  getOrgPortalUrl: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: { setActive: vi.fn() },
    signOut: vi.fn(),
    useActiveOrganization: () => ({
      data: {
        id: "org_1",
        name: "Acme",
        members: [{ userId: "user_1", role: "owner" }],
      },
    }),
    useListOrganizations: () => ({
      data: [{ id: "org_1", name: "Acme" }],
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

import { getOrgPortalUrl } from "@/data/billing";
import { NavUser } from "./nav-user";

describe("NavUser", () => {
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
    vi.mocked(getOrgPortalUrl).mockResolvedValueOnce({
      status: "customer_missing",
    } as never);
    await user.click(screen.getByText("Billing details"));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/billing" });
    });
  });
});
