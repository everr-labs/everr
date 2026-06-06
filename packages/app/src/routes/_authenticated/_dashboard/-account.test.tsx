import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCurrentUserAccount: vi.fn().mockResolvedValue(undefined),
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
    useActiveOrganization: mocks.useActiveOrganization,
    useSession: mocks.useSession,
  },
}));

import { Route } from "./account";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteCurrentUserAccount.mockResolvedValue(undefined);
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

  it("shows the organization deletion option to active organization admins", async () => {
    const user = userEvent.setup();
    mocks.useActiveOrganization.mockReturnValue({
      data: {
        id: "test_org",
        name: "Acme",
        members: [{ userId: "test_user", role: "admin" }],
      },
    });
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(
      screen.getByLabelText("Delete Acme organization too"),
    ).toBeInTheDocument();
  });

  it("hides the organization deletion option from non-admin members", async () => {
    const user = userEvent.setup();
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
        members: [{ userId: "test_user", role: "owner" }],
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
});
