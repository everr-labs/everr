import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@everr/app/account-settings", () => ({
  AccountSettings: ({
    googleSignInEnabled,
    children,
  }: {
    googleSignInEnabled: boolean;
    children: ReactNode;
  }) => (
    <section
      aria-label={googleSignInEnabled ? "Google enabled" : "Google disabled"}
    >
      {children}
    </section>
  ),
}));
vi.mock("../components/account-deletion", () => ({
  AccountDeletion: () => (
    <button type="button">Delete account and organization</button>
  ),
}));

const policy = vi.hoisted(() => vi.fn());
vi.mock("@everr/app/data/product", () => ({ getActiveOrgPolicy: policy }));
vi.mock("@everr/app/members", () => ({
  OrganizationMembersPage: () => <div>Member management</div>,
}));
vi.mock("../components/members-unavailable", () => ({
  MembersUnavailable: () => <div>Upgrade plan</div>,
}));

import { pages } from "./pages";
const Members = pages.members.component;

beforeEach(() => policy.mockReset());

it.each([
  true,
  false,
])("renders the selected page after loading policy (invitations: %s)", async (canInviteMembers) => {
  const queryClient = new QueryClient();
  policy.mockResolvedValue({ canInviteMembers });
  await pages.members.load?.({ queryClient, organizationId: "org" });
  render(
    <QueryClientProvider client={queryClient}>
      <Members organizationId="org" />
    </QueryClientProvider>,
  );
  expect(
    screen.getByText(canInviteMembers ? "Member management" : "Upgrade plan"),
  ).toBeVisible();
  expect(policy).toHaveBeenCalledTimes(1);
});

it("refreshes policy when revisiting and isolates organizations", async () => {
  const queryClient = new QueryClient();
  policy
    .mockResolvedValueOnce({ canInviteMembers: false })
    .mockResolvedValueOnce({ canInviteMembers: true })
    .mockResolvedValueOnce({ canInviteMembers: false });
  await pages.members.load?.({ queryClient, organizationId: "first" });
  await pages.members.load?.({ queryClient, organizationId: "first" });
  await pages.members.load?.({ queryClient, organizationId: "second" });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Members organizationId="first" />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Member management")).toBeVisible();
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <Members organizationId="second" />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Upgrade plan")).toBeVisible();
  expect(policy).toHaveBeenCalledTimes(3);
});

it.each([
  true,
  false,
])("assembles account settings with its deletion flow (Google: %s)", (googleSignInEnabled) => {
  render(<pages.account googleSignInEnabled={googleSignInEnabled} />);
  expect(
    screen.getByRole("region", {
      name: googleSignInEnabled ? "Google enabled" : "Google disabled",
    }),
  ).toContainElement(
    screen.getByRole("button", { name: "Delete account and organization" }),
  );
});
