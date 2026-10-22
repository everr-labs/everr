import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { INVITATION_EMAIL_HEADER } from "#app/common/invitation.ts";

const mocks = vi.hoisted(() => ({ invite: vi.fn(), emailEnabled: true }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ emailEnabled: mocks.emailEnabled }),
}));
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: { organization: { inviteMember: mocks.invite } },
}));

import { InviteMemberDialog } from "./invite-member-dialog";

beforeEach(() => {
  mocks.invite.mockReset().mockResolvedValue({
    data: { id: "invite-123" },
    error: null,
  });
});

it.each([
  { sendEmail: true, emailEnabled: true },
  { sendEmail: false, emailEnabled: true },
  { sendEmail: false, emailEnabled: false },
])(
  "creates a copyable invitation with email=$sendEmail, available=$emailEnabled",
  async ({ sendEmail, emailEnabled }) => {
    mocks.emailEnabled = emailEnabled;
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InviteMemberDialog />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    await user.type(screen.getByRole("textbox", { name: "Email" }), "teammate@example.test");
    const emailOption = screen.getByRole("switch", {
      name: "Send invitation email",
    });
    expect(emailOption).toHaveAttribute("aria-checked", String(emailEnabled));
    expect(emailOption.getAttribute("aria-disabled") === "true").toBe(!emailEnabled);
    if (emailEnabled && !sendEmail) await user.click(emailOption);
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    const url = `${window.location.origin}/invite/invite-123`;
    expect(await screen.findByText(url)).toBeVisible();
    expect(mocks.invite).toHaveBeenCalledWith({
      email: "teammate@example.test",
      role: "member",
      fetchOptions: { headers: { [INVITATION_EMAIL_HEADER]: String(sendEmail) } },
    });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
    expect(copy).toHaveBeenCalledWith(url);
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("switch", { name: "Send invitation email" })).toHaveAttribute(
      "aria-checked",
      String(emailEnabled),
    );
  },
);

it("sends the selected owner role instead of falling back to member", async () => {
  mocks.emailEnabled = false;
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InviteMemberDialog />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Invite member" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "owner@example.test");
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  await user.click(await screen.findByRole("option", { name: "Owner" }));
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText(`${window.location.origin}/invite/invite-123`)).toBeVisible();
  expect(mocks.invite).toHaveBeenCalledWith({
    email: "owner@example.test",
    role: "owner",
    fetchOptions: { headers: { [INVITATION_EMAIL_HEADER]: "false" } },
  });
});

it("rejects a malformed invitation response without showing a broken link", async () => {
  mocks.emailEnabled = false;
  mocks.invite.mockResolvedValueOnce({ data: { id: 42 }, error: null });
  const errorToast = vi.spyOn(toast, "error").mockReturnValue(0);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InviteMemberDialog />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Invite member" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "invitee@example.test");
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  await waitFor(() =>
    expect(errorToast).toHaveBeenCalledWith(
      "Invitation link could not be loaded. Refresh pending invitations.",
    ),
  );
  expect(screen.queryByText(/\/invite\//)).not.toBeInTheDocument();
  errorToast.mockRestore();
});
