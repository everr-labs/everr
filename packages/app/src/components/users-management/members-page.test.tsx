import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ listMembers: vi.fn(), listInvitations: vi.fn() }));
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: { organization: mocks, useSession: () => ({ data: { user: { id: "owner-user" } } }) },
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ emailEnabled: false }) }));
import { OrganizationMembersPage } from "./members-page";

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
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

it("preserves the empty members presentation when the request fails", async () => {
  mocks.listMembers.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
  renderPage();
  expect(await screen.findByText("No members found.")).toBeVisible();
  expect(screen.queryByText("Failed to load members")).not.toBeInTheDocument();
});

it("keeps composite role handling consistent with the original member table", async () => {
  mocks.listMembers.mockResolvedValue({
    data: [
      {
        id: "member-1",
        userId: "other-user",
        role: "member,owner",
        createdAt: new Date(),
        user: { name: "Other User", email: "other@example.test" },
      },
    ],
    error: null,
  });
  renderPage();
  expect(await screen.findByRole("combobox")).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove" })).toBeVisible();
});
