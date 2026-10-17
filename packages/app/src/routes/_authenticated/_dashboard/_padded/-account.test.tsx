import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@composition/ui", async () => import("@/product/ui"));

const mocks = vi.hoisted(() => ({
  googleEnabled: true,
  updateUser: vi.fn(),
  changePassword: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  deleteCurrentUserAccount: vi.fn().mockResolvedValue(undefined),
  linkSocial: vi.fn(),
  listAccounts: vi.fn(),
  navigate: vi.fn(),
  useActiveOrganization: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
      options,
      useRouteContext: () => ({ googleSignInEnabled: mocks.googleEnabled }),
    }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/data/account-settings", () => ({
  deleteCurrentUserAccount: mocks.deleteCurrentUserAccount,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    updateUser: mocks.updateUser,
    changePassword: mocks.changePassword,
    listSessions: mocks.listSessions,
    revokeSession: mocks.revokeSession,
    revokeOtherSessions: mocks.revokeOtherSessions,
    linkSocial: mocks.linkSocial,
    listAccounts: mocks.listAccounts,
    useActiveOrganization: mocks.useActiveOrganization,
    useSession: mocks.useSession,
  },
}));

import { Route } from "./account";

function session(id: string) {
  return {
    id,
    token: `secret-${id}`,
    userId: "test_user",
    userAgent: `Device ${id}`,
    ipAddress: "127.0.0.1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    expiresAt: new Date("2099-01-01"),
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Component = Route.options.component as React.ComponentType;
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.googleEnabled = true;
  for (const mutation of [
    mocks.updateUser,
    mocks.changePassword,
    mocks.revokeSession,
    mocks.revokeOtherSessions,
  ]) {
    mutation.mockResolvedValue({ data: {}, error: null });
  }
  mocks.listSessions.mockResolvedValue({
    data: [session("current")],
    error: null,
  });
  mocks.deleteCurrentUserAccount.mockResolvedValue(undefined);
  mocks.linkSocial.mockResolvedValue({ data: null, error: null });
  mocks.listAccounts.mockResolvedValue({
    data: [{ providerId: "credential" }],
    error: null,
  });
  mocks.useSession.mockReturnValue({
    data: {
      user: { id: "test_user", name: "Test User", email: "test@example.com" },
      session: { id: "current" },
    },
  });
  mocks.useActiveOrganization.mockReturnValue({
    data: {
      id: "test_org",
      name: "Test Org",
      members: [{ userId: "test_user", role: "member" }],
    },
  });
});

describe("/account route", () => {
  it("edits the display name, retains the draft after failure, and keeps email read-only", async () => {
    const user = userEvent.setup();
    mocks.updateUser.mockResolvedValueOnce({
      error: { message: "Could not save" },
    });
    renderPage();
    expect(screen.getByText("Account Settings")).toBeInTheDocument();
    expect(screen.queryByText("GitHub Connection")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Manage GitHub" }),
    ).not.toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "  New Name  ");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Could not save")).toBeVisible();
    expect(name).toHaveValue("  New Name  ");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Profile saved.")).toBeVisible();
    expect(mocks.updateUser).toHaveBeenLastCalledWith({ name: "New Name" });
  });

  it("validates password confirmation and keeps sessions signed in after changing the password", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValueOnce({
      error: { message: "Current password is incorrect" },
    });
    renderPage();
    const current = await screen.findByLabelText("Current password");
    const password = screen.getByLabelText("New password");
    const confirmation = screen.getByLabelText("Confirm new password");
    await user.type(current, "old-password");
    await user.type(password, "new-password");
    await user.type(confirmation, "different-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      await screen.findByText("New passwords do not match."),
    ).toBeVisible();
    expect(mocks.changePassword).not.toHaveBeenCalled();
    await user.clear(confirmation);
    await user.type(confirmation, "new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      await screen.findByText("Current password is incorrect"),
    ).toBeVisible();
    expect(current).toHaveValue("old-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed.")).toBeVisible();
    expect(mocks.changePassword).toHaveBeenLastCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password",
      revokeOtherSessions: false,
    });
    for (const input of [current, password, confirmation])
      expect(input).toHaveValue("");
    expect(mocks.revokeSession).not.toHaveBeenCalled();
    expect(mocks.revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("revokes individual and remaining sessions, refreshes the list, and preserves the current session", async () => {
    const user = userEvent.setup();
    mocks.listSessions.mockResolvedValue({
      data: [session("current"), session("other"), session("cli")],
      error: null,
    });
    mocks.revokeSession.mockImplementation(async () => {
      mocks.listSessions.mockResolvedValue({
        data: [session("current"), session("cli")],
        error: null,
      });
      return { error: null };
    });
    mocks.revokeOtherSessions.mockImplementation(async () => {
      mocks.listSessions.mockResolvedValue({
        data: [session("current")],
        error: null,
      });
      return { error: null };
    });
    renderPage();
    const current = (await screen.findByText("Current session")).closest("li");
    if (!current) throw new Error("Current session row is missing");
    expect(within(current).queryByRole("button")).not.toBeInTheDocument();
    const other = screen.getByText("Device other").closest("li");
    if (!other) throw new Error("Other session row is missing");
    await user.click(
      within(other).getByRole("button", { name: "Sign out session" }),
    );
    expect(mocks.revokeSession).toHaveBeenCalledWith({ token: "secret-other" });
    await waitFor(() =>
      expect(screen.queryByText("Device other")).not.toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("button", { name: "Sign out other sessions" }),
    );
    expect(mocks.revokeOtherSessions).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByText("Device cli")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Current session")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sign out other sessions" }),
    ).toBeDisabled();
    expect(document.body.innerHTML).not.toContain("secret-");
  });

  it("keeps sessions visible after a failed revocation and lets users retry a failed session load", async () => {
    const user = userEvent.setup();
    mocks.listSessions.mockResolvedValueOnce({
      error: { message: "Could not load" },
    });
    mocks.listSessions.mockResolvedValue({
      data: [session("current"), session("other")],
      error: null,
    });
    mocks.revokeSession.mockResolvedValueOnce({
      error: { message: "Could not sign out" },
    });
    renderPage();
    expect(
      await screen.findByText(/Could not load sessions: Could not load/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(
      await screen.findByRole("button", { name: "Sign out session" }),
    );
    expect(await screen.findByText("Could not sign out")).toBeVisible();
    expect(screen.getByText("Device other")).toBeVisible();
  });

  it.each([
    true,
    false,
  ])("only links Google accounts when configured (%s)", async (enabled) => {
    const user = userEvent.setup();
    mocks.googleEnabled = enabled;
    renderPage();
    await screen.findByLabelText("Current password");
    if (!enabled) {
      expect(screen.queryByText("Google Connection")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Connect Google" }),
      ).not.toBeInTheDocument();
      expect(mocks.linkSocial).not.toHaveBeenCalled();
      return;
    }
    await user.click(screen.getByRole("button", { name: "Connect Google" }));
    expect(mocks.linkSocial).toHaveBeenCalledWith({
      callbackURL: "/account",
      provider: "google",
    });
  });

  it("shows linked Google accounts without offering a local password", async () => {
    mocks.listAccounts.mockResolvedValue({
      data: [{ providerId: "google" }],
      error: null,
    });
    renderPage();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Linked" })).toBeDisabled();
    expect(
      screen.getByText("Your password is managed by your sign-in provider."),
    ).toBeVisible();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("allows account deletion to start without an active organization", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({ data: null });
    renderPage();
    expect(screen.getByText("Danger Zone")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Confirmation"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    await waitFor(() => {
      expect(mocks.deleteCurrentUserAccount).toHaveBeenCalledWith({
        data: { confirmation: "DELETE" },
      });
    });
  });

  it("shows the workspace ownership block from the server", async () => {
    const user = userEvent.setup();
    mocks.deleteCurrentUserAccount.mockRejectedValueOnce(
      new Error(
        "You can't delete your account while you are an owner of a workspace. Transfer ownership of: Acme.",
      ),
    );
    renderPage();

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Confirmation"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent(
      "You can't delete your account while you are an owner of a workspace. Transfer ownership of: Acme.",
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
