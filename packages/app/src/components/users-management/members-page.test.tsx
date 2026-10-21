import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ listMembers: vi.fn(), listInvitations: vi.fn() }));
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: {
    organization: mocks,
    useSession: () => ({ data: { user: { id: "owner-user" } } }),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ emailEnabled: false }),
}));

import { OrganizationMembersPage } from "./members-page";

const member = {
  id: "owner-member",
  userId: "owner-user",
  role: "owner",
  createdAt: "2026-10-21T12:00:00.000Z",
  user: { name: "Workspace Owner", email: "owner@example.test" },
};
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  mocks.listMembers.mockResolvedValue({ data: { members: [member] }, error: null });
  mocks.listInvitations.mockResolvedValue({ data: [], error: null });
});
afterEach(() => client.clear());

function renderPage() {
  render(
    <QueryClientProvider client={client}>
      <OrganizationMembersPage />
    </QueryClientProvider>,
  );
}

it("shows a retry state for malformed members and recovers after a valid response", async () => {
  mocks.listMembers.mockResolvedValueOnce({ data: [{ ...member, role: 42 }], error: null });
  renderPage();
  expect(await screen.findByText("Failed to load members")).toBeVisible();
  expect(screen.queryByText("No members found.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Zod|invalid_type/)).not.toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Workspace Owner")).toBeVisible();
  expect(screen.queryByText("Failed to load members")).not.toBeInTheDocument();
});

it("keeps invitation failures visible and retries without blocking the members list", async () => {
  mocks.listInvitations.mockResolvedValueOnce({ data: { invitations: null }, error: null });
  mocks.listInvitations.mockResolvedValue({
    data: [
      {
        id: "invite-1",
        email: "pending@example.test",
        role: "admin",
        status: "pending",
        expiresAt: "2026-10-22T12:00:00.000Z",
      },
    ],
    error: null,
  });
  renderPage();
  expect(await screen.findByText("Failed to load invitations")).toBeVisible();
  expect(await screen.findByText("Workspace Owner")).toBeVisible();

  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("pending@example.test")).toBeVisible();
  expect(screen.queryByText("Failed to load invitations")).not.toBeInTheDocument();
});
