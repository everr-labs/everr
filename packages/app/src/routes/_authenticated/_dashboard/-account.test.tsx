import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClientMocks = vi.hoisted(() => ({
  linkSocial: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
      options,
    }),
    Link: (props: {
      to: string;
      className?: string;
      reloadDocument?: boolean;
      children: ReactNode;
    }) => (
      <a href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/lib/auth-client", () => ({
  authClient: authClientMocks,
}));

import { Route } from "./account";

describe("/account route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authClientMocks.linkSocial.mockResolvedValue({ data: null, error: null });
    authClientMocks.listAccounts.mockResolvedValue({ data: [], error: null });
  });

  it("renders account settings page with heading and danger zone", () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText("Account Settings")).toBeInTheDocument();
    expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    expect(screen.getByText("Delete account")).toBeInTheDocument();
  });

  it("renders GitHub connection card", () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText("GitHub Connection")).toBeInTheDocument();
    expect(screen.getByText("Connect GitHub")).toBeInTheDocument();
  });

  it("renders Google connection card", async () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText("Google Connection")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeInTheDocument();
  });

  it("starts Google account linking from account settings", async () => {
    const user = userEvent.setup();
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(
      await screen.findByRole("button", { name: "Connect Google" }),
    );

    expect(authClientMocks.linkSocial).toHaveBeenCalledWith({
      callbackURL: "/account",
      provider: "google",
    });
  });

  it("shows Google as connected when it is already linked", async () => {
    authClientMocks.listAccounts.mockResolvedValueOnce({
      data: [
        {
          accountId: "google-account",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          id: "account-row",
          providerId: "google",
          scopes: [],
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          userId: "user-id",
        },
      ],
      error: null,
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Linked" })).toBeDisabled();
  });
});
