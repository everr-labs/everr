import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/data/account-settings", () => ({
  deleteCurrentUserAccount: mocks.deleteCurrentUserAccount,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    linkSocial: mocks.linkSocial,
    listAccounts: mocks.listAccounts,
    useActiveOrganization: mocks.useActiveOrganization,
    useSession: mocks.useSession,
  },
}));

import { Route } from "./account";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteCurrentUserAccount.mockResolvedValue(undefined);
  mocks.linkSocial.mockResolvedValue({ data: null, error: null });
  mocks.listAccounts.mockResolvedValue({ data: [], error: null });
  mocks.useSession.mockReturnValue({
    data: { user: { id: "test_user", email: "test@example.com" } },
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

    expect(mocks.linkSocial).toHaveBeenCalledWith({
      callbackURL: "/account",
      provider: "google",
    });
  });

  it("shows Google as connected when it is already linked", async () => {
    mocks.listAccounts.mockResolvedValueOnce({
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

  it("shows the organization deletion option to active organization owners", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Acme",
        members: [{ userId: "test_user", role: "owner" }],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(
      screen.getByLabelText("Delete Acme organization too"),
    ).toBeInTheDocument();
  });

  it("requires deleting the organization when the user is its only owner", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Acme",
        members: [
          { userId: "test_user", role: "owner" },
          { userId: "member_user", role: "member" },
        ],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));

    const checkbox = screen.getByLabelText("Delete Acme organization too");
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });

  it("hides the organization deletion option from organization admins", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Test Org",
        members: [{ userId: "test_user", role: "admin" }],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(
      screen.queryByLabelText("Delete Test Org organization too"),
    ).not.toBeInTheDocument();
  });

  it("passes the organization deletion choice when confirmed", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Acme",
        members: [
          { userId: "test_user", role: "owner" },
          { userId: "other_owner", role: "owner" },
        ],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Confirmation"), "DELETE");
    await user.click(screen.getByLabelText("Delete Acme organization too"));
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    await waitFor(() => {
      expect(mocks.deleteCurrentUserAccount).toHaveBeenCalledWith({
        data: { confirmation: "DELETE", deleteOrganization: true },
      });
    });
  });

  it("passes organization deletion without an extra checkbox click for the only owner", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Acme",
        members: [{ userId: "test_user", role: "owner" }],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.type(screen.getByLabelText("Confirmation"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    await waitFor(() => {
      expect(mocks.deleteCurrentUserAccount).toHaveBeenCalledWith({
        data: { confirmation: "DELETE", deleteOrganization: true },
      });
    });
  });
});
