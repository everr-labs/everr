import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const policy = vi.hoisted(() => vi.fn());
vi.mock("@everr/app/data/product", () => ({ getActiveOrgPolicy: policy }));
vi.mock("@everr/app/members", () => ({
  OrganizationMembersPage: () => <div>Member management</div>,
}));
vi.mock("../../components/members-unavailable", () => ({
  MembersUnavailable: () => <div>Upgrade plan</div>,
}));

import { pages } from "./pages";

const Members = pages.members.component;

beforeEach(() => policy.mockReset());

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
