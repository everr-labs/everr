import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaderData: {
    deviceCode: "ABCD1234",
    userName: "CLI",
    orgName: "Org A",
    activeOrganizationId: "org-a",
    organizations: [
      { id: "org-a", name: "Org A" },
      { id: "org-b", name: "Org B" },
    ],
  },
  approveDevice: vi.fn(),
  denyDevice: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => mocks.loaderData,
  }),
}));
vi.mock("@/data/auth", () => ({
  getActiveOrganization: vi.fn(),
  getOrganizations: vi.fn(),
}));
vi.mock("@/lib/device-auth", () => ({
  approveDevice: mocks.approveDevice,
  denyDevice: mocks.denyDevice,
}));

import { Route } from "./device";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loaderData.organizations = [
    { id: "org-a", name: "Org A" },
    { id: "org-b", name: "Org B" },
  ];
  mocks.approveDevice.mockResolvedValue({ ok: true });
  mocks.denyDevice.mockResolvedValue({ ok: true });
});

function renderPage() {
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

it("approves the device with the organization selected from the dropdown", async () => {
  const user = userEvent.setup();
  renderPage();

  const selector = screen.getByRole("combobox", { name: "Organization" });
  expect(selector).toHaveTextContent("Org A");
  await user.click(selector);
  await user.click(await screen.findByRole("option", { name: "Org B" }));
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  expect(mocks.approveDevice).toHaveBeenCalledWith("ABCD1234", "org-b");
  expect(await screen.findByText("Device approved")).toBeVisible();
});

it("uses the only organization without showing a dropdown", async () => {
  mocks.loaderData.organizations = [{ id: "org-a", name: "Org A" }];
  const user = userEvent.setup();
  renderPage();

  expect(screen.queryByRole("combobox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  expect(mocks.approveDevice).toHaveBeenCalledWith("ABCD1234", "org-a");
});

it("shows an organization activation error and allows retrying", async () => {
  mocks.approveDevice.mockResolvedValueOnce({
    ok: false,
    message: "You are no longer a member of this organization.",
  });
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "Confirm" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "You are no longer a member of this organization.",
  );
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Device approved")).toBeVisible();
});

it("denies the request without activating the selected organization", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole("button", { name: "Deny" }));

  expect(mocks.denyDevice).toHaveBeenCalledWith("ABCD1234");
  expect(mocks.approveDevice).not.toHaveBeenCalled();
  expect(await screen.findByText("Request denied")).toBeVisible();
});
