import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    if (emailEnabled) expect(emailOption).toBeChecked();
    else expect(emailOption).toHaveAttribute("aria-disabled", "true");
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
