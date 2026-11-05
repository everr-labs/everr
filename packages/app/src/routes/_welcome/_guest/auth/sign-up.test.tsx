import { render, screen, waitFor } from "@testing-library/react";
import type * as RouterModule from "@tanstack/react-router";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { SignupPolicy } from "#app/composition/ui.ts";

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  social: vi.fn(),
  policy: { canSubmit: true } as SignupPolicy,
}));
vi.mock("@composition/ui", () => ({
  productUI: { useSignupPolicy: () => mocks.policy },
}));
vi.mock("#app/lib/auth-client.ts", () => ({
  authClient: {
    signUp: { email: mocks.email },
    signIn: { social: mocks.social },
  },
}));
vi.mock("#app/data/signup.ts", () => ({
  canOpenSignup: vi.fn().mockResolvedValue(true),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useRouteContext: () => ({ googleSignInEnabled: true }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { Route } from "./sign-up";

const Signup = Route.options.component as ComponentType;

beforeEach(() => {
  mocks.policy = { canSubmit: true };
  mocks.email.mockReset().mockResolvedValue({ error: { message: "Test response" } });
  mocks.social.mockReset().mockResolvedValue({ error: { message: "Test response" } });
});

it("applies the product signup restriction to both actions", () => {
  mocks.policy = { canSubmit: false, notice: <p>Signup requirements</p> };
  render(<Signup />);
  expect(screen.getByText("Signup requirements")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Sign up$/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sign up with Google" })).toBeDisabled();
});

it("sends the product's acceptance evidence with email signup", async () => {
  mocks.policy = {
    canSubmit: true,
    additionalData: { termsHash: "accepted-revision" },
  };
  const user = userEvent.setup();
  render(<Signup />);
  await user.type(screen.getByLabelText("Name"), "Test user");
  await user.type(screen.getByLabelText("Email"), "person@example.com");
  await user.type(screen.getByLabelText("Password"), "long-test-password");
  await user.click(screen.getByRole("button", { name: /^Sign up$/ }));
  await waitFor(() =>
    expect(mocks.email).toHaveBeenCalledWith({
      termsHash: "accepted-revision",
      name: "Test user",
      email: "person@example.com",
      password: "long-test-password",
      callbackURL: "/",
    }),
  );
});

it("sends the product's acceptance evidence into Google OAuth state", async () => {
  mocks.policy = {
    canSubmit: true,
    additionalData: { termsHash: "accepted-revision" },
  };
  const user = userEvent.setup();
  render(<Signup />);
  await user.click(screen.getByRole("button", { name: "Sign up with Google" }));
  expect(mocks.social).toHaveBeenCalledWith({
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/auth/sign-up",
    additionalData: mocks.policy.additionalData,
  });
});
