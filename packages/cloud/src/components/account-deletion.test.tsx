import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useActiveOrganization: vi.fn(),
  deleteCurrentUserAccount: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@everr/app/identity/client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "test_user" } } }),
    useActiveOrganization: mocks.useActiveOrganization,
  },
}));
vi.mock("@everr/app/account-settings/actions", () => ({
  deleteCurrentUserAccount: mocks.deleteCurrentUserAccount,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

import { AccountDeletion } from "./account-deletion";

function renderPage() {
  return render(<AccountDeletion />);
}
beforeEach(() => {
  mocks.deleteCurrentUserAccount.mockReset().mockResolvedValue(undefined);
});

it("hides organization deletion for non-owners", async () => {
  const user = userEvent.setup();
  mocks.useActiveOrganization.mockReturnValue({
    data: {
      id: "test_org",
      name: "Test Org",
      members: [
        {
          userId: "test_user",
          role: "admin",
        },
      ],
    },
  });
  renderPage();

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
  renderPage();

  await user.click(screen.getByRole("button", { name: "Delete account" }));
  await user.type(screen.getByLabelText("Confirmation"), "DELETE");
  await user.click(screen.getByLabelText("Delete Acme organization too"));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));

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
      members: [
        { userId: "test_user", role: "owner" },
        { userId: "member_user", role: "member" },
      ],
    },
  });
  renderPage();

  await user.click(screen.getByRole("button", { name: "Delete account" }));
  expect(
    screen.getByText(
      "This action is also going to delete the Acme organization.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Delete Acme organization too"),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Confirmation"), "DELETE");
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));

  await waitFor(() => {
    expect(mocks.deleteCurrentUserAccount).toHaveBeenCalledWith({
      data: { confirmation: "DELETE", deleteOrganization: true },
    });
  });
});
