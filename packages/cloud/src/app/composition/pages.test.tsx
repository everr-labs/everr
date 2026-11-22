import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const policy = vi.hoisted(() => vi.fn());
const prefetchMembers = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@everr/app/data/product", () => ({ getActiveOrgPolicy: policy }));
vi.mock("@everr/app/members", () => ({
  OrganizationMembersPage: () => <div>Member management</div>,
  prefetchMembersPage: prefetchMembers,
}));
vi.mock("@everr/app/account-settings", () => ({ AccountSettings: () => null }));
vi.mock("../../components/members-unavailable", () => ({
  MembersUnavailable: () => <div>Upgrade plan</div>,
}));

import { pages } from "./pages";

const Members = pages.members.component;

beforeEach(() => {
  policy.mockReset();
  prefetchMembers.mockClear();
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
  // Only the visit whose plan allows inviting loads the member lists.
  expect(prefetchMembers).toHaveBeenCalledTimes(1);
});
