import { InvitationAccess } from "@app/pages/invitation";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  verified: false,
  send: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { email: "teammate@example.test", emailVerified: state.verified },
      },
      isPending: false,
    }),
    sendVerificationEmail: state.send,
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.verified = false;
});
it("keeps acceptance hidden until verification and resends to the invitation", async () => {
  render(
    <InvitationAccess invitationId="invite-1">
      <button type="button">Accept</button>
    </InvitationAccess>,
  );
  expect(
    screen.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Resend verification email" }),
  );
  expect(
    await screen.findByText("Verification email sent. Check your inbox."),
  ).toBeVisible();
  expect(state.send).toHaveBeenCalledWith({
    email: "teammate@example.test",
    callbackURL: "/invite/invite-1",
  });
});
it("shows acceptance for a verified teammate", () => {
  state.verified = true;
  render(
    <InvitationAccess invitationId="invite-1">
      <button type="button">Accept</button>
    </InvitationAccess>,
  );
  expect(screen.getByRole("button", { name: "Accept" })).toBeVisible();
});
