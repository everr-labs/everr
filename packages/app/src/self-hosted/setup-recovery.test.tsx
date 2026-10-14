import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("@/app/setup", () => ({ completeSetup: mocks.setup }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: mocks.signIn } },
}));

import { Route } from "@/app/routes/_welcome/setup";

beforeEach(() => {
  vi.resetAllMocks();
});

function show() {
  const Page = Route.options.component as ComponentType;
  render(<Page />);
  for (const [label, value] of [
    ["Setup token", "test-setup-token-with-at-least-32-characters"],
    ["Workspace name", "Recovery workspace"],
    ["Your name", "Owner"],
    ["Email", "owner@example.test"],
    ["Password", "test-owner-password"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

it.each([
  "response error",
  "network exception",
])("offers sign-in without another setup submission after creation (%s)", async (failure) => {
  mocks.setup.mockResolvedValue({ organizationId: "workspace" });
  if (failure === "response error") {
    mocks.signIn.mockResolvedValue({ error: { message: "Sign-in failed" } });
  } else {
    mocks.signIn.mockRejectedValue(new Error("Connection lost"));
  }
  show();
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/auth/sign-in?redirect=%2Forganization-setup",
  );
  expect(screen.queryByRole("button", { name: "Create workspace" })).toBeNull();
  expect(mocks.setup).toHaveBeenCalledTimes(1);
});

it("keeps setup retryable after rollback and offers sign-in if the response was lost", async () => {
  mocks.setup.mockRejectedValueOnce(new Error("Connection lost"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(
    screen.getByRole("link", { name: "sign in with your owner account" }),
  ).toHaveAttribute("href", "/auth/sign-in?redirect=%2Forganization-setup");
  expect(mocks.signIn).not.toHaveBeenCalled();
  mocks.setup.mockResolvedValue({ organizationId: "workspace" });
  mocks.signIn.mockResolvedValue({ error: { message: "Sign in manually" } });
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce());
  expect(mocks.setup).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Create workspace" })).toBeNull();
});
