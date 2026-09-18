import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  entitlement: vi.fn(),
  portal: vi.fn(),
  checkout: vi.fn(),
  settings: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock("@/data/organizations", () => ({ createOrganization: mocks.create }));
vi.mock("@/data/billing", () => ({
  ensureOrgBillingAdmin: vi.fn(),
  getOrgBillingSettings: mocks.settings,
  changeOrgBillingOwner: mocks.transfer,
  getOrgEntitlement: mocks.entitlement,
  getOrgPortalUrl: mocks.portal,
  startOrgCheckout: mocks.checkout,
  NotBillingAdminError: class extends Error {},
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: "org", name: "Acme" } }),
    organization: { setActive: vi.fn() },
  },
}));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import { CreateOrganizationDialog } from "@/components/create-organization-dialog";
import { Route } from "@/routes/_authenticated/_dashboard/_padded/billing";

const BillingPage = Route.options.component as ComponentType;
function billingPage() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <BillingPage />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({
    owner: { id: "owner", name: "Owner", email: "owner@example.com" },
    candidates: [],
    canChangeOwner: false,
  });
});
it("submits a new Pro organization with only its plan and name", async () => {
  mocks.create.mockRejectedValue(new Error("Test checkout failure"));
  render(
    <CreateOrganizationDialog
      canCreateHobby={false}
      open
      onOpenChange={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText(/billing email/i)).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Organization name"), "Acme");
  await userEvent.click(
    screen.getByRole("button", { name: "Continue to checkout" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Test checkout failure",
  );
  expect(mocks.create).toHaveBeenCalledWith({
    data: { plan: "pro", organizationName: "Acme" },
  });
});
it("shows upgrade immediately for a Hobby organization", async () => {
  mocks.entitlement.mockResolvedValue({ plan: "hobby", appState: "hobby" });
  mocks.checkout.mockRejectedValue(new Error("Checkout unavailable"));
  billingPage();
  const upgrade = await screen.findByRole("button", { name: "Upgrade to Pro" });
  expect(screen.queryByLabelText(/billing email/i)).not.toBeInTheDocument();
  await userEvent.click(upgrade);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Checkout unavailable",
  );
  expect(upgrade).toBeEnabled();
  expect(mocks.checkout).toHaveBeenCalledWith({ data: { slug: "pro" } });
});
it("keeps the portal retryable when the customer is missing", async () => {
  mocks.entitlement.mockResolvedValue({ plan: "pro", appState: "pro" });
  mocks.portal.mockRejectedValue(
    new Error(
      "Billing is currently unavailable. Please try again or contact support.",
    ),
  );
  billingPage();
  const portal = await screen.findByRole("button", {
    name: "Open billing portal",
  });
  await userEvent.click(portal);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Billing is currently unavailable",
  );
  expect(portal).toBeEnabled();
  expect(screen.queryByLabelText(/billing email/i)).not.toBeInTheDocument();
});

it("allows an owner to select a different billing owner", async () => {
  mocks.entitlement.mockResolvedValue({ plan: "pro", appState: "pro" });
  const people = [
    { id: "owner", name: "Owner", email: "owner@example.com" },
    { id: "other", name: "Other", email: "other@example.com" },
  ];
  mocks.settings.mockResolvedValue({
    owner: people[0],
    candidates: people,
    canChangeOwner: true,
  });
  mocks.transfer.mockResolvedValue({ status: "completed" });
  billingPage();
  await userEvent.selectOptions(
    await screen.findByLabelText("Billing owner"),
    "other",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save billing owner" }),
  );
  expect(mocks.transfer).toHaveBeenCalledWith({ data: { userId: "other" } });
});
