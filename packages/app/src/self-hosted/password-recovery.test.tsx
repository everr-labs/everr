import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ emailEnabled: false, request: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouteContext: () => ({ emailEnabled: state.emailEnabled }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/auth/sign-in">{children}</a>
  ),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { requestPasswordReset: state.request },
}));

import { Route } from "@/routes/_welcome/_guest/auth/forgot-password";

beforeEach(() => {
  state.emailEnabled = false;
  state.request.mockReset().mockResolvedValue({ error: null });
});

it("offers operator recovery without submitting an email request when SMTP is unavailable", async () => {
  const Component = Route.options.component as React.ComponentType;
  render(<Component />);
  expect(
    screen.getByText("Contact your installation administrator"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Send reset link" })).toBeNull();
  await userEvent.click(screen.getByText("Manage this installation?"));
  expect(screen.getByText(/recovery.mjs link --email/)).toBeVisible();
  expect(screen.getByText(/recovery.mjs password --email/)).toBeVisible();
  expect(state.request).not.toHaveBeenCalled();
});

it("retains email recovery when SMTP is available", async () => {
  state.emailEnabled = true;
  const Component = Route.options.component as React.ComponentType;
  render(<Component />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "member@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(state.request).toHaveBeenCalledWith({
    email: "member@example.test",
    redirectTo: "/auth/reset-password",
  });
  expect(
    await screen.findByText("Check your email for a password reset link."),
  ).toBeVisible();
});
