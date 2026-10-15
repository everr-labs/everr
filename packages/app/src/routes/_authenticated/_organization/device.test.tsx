import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  organizationId: "org-work",
  expectedOrganizationId: undefined as string | undefined,
  approve: vi.fn(),
  deny: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => ({
      deviceCode: "CODE",
      userName: "Alice",
      orgName: "Work",
      activeOrganizationId: state.organizationId,
    }),
    useSearch: () => ({ organization_id: state.expectedOrganizationId }),
  }),
}));
vi.mock("@app/navigation", () => ({
  OrganizationSwitcher: ({
    onSwitchingChange,
  }: {
    onSwitchingChange: (switching: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onSwitchingChange(true)}>
        Start switch
      </button>
      <button type="button" onClick={() => onSwitchingChange(false)}>
        Finish switch
      </button>
    </>
  ),
}));
vi.mock("@/lib/device-auth", () => ({
  approveDevice: state.approve,
  denyDevice: state.deny,
}));

import { Route } from "./device";

beforeEach(() => {
  state.organizationId = "org-work";
  state.expectedOrganizationId = undefined;
  state.approve.mockReset().mockResolvedValue({ ok: true });
  state.deny.mockReset().mockResolvedValue({ ok: true });
});

it("allows approval of the selected organization", async () => {
  state.expectedOrganizationId = "org-work";
  const Component = Route.options.component as ComponentType;
  render(<Component />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(state.approve).toHaveBeenCalledWith("CODE");
  expect(await screen.findByText("Device approved")).toBeVisible();
});

it("requires the profile's expected organization while keeping denial available", async () => {
  state.expectedOrganizationId = "org-other";
  const Component = Route.options.component as ComponentType;
  render(<Component />);
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(state.approve).not.toHaveBeenCalled();
  expect(state.deny).toHaveBeenCalledWith("CODE");
});

it("blocks approval during an organization switch even when the current organization matches", async () => {
  state.expectedOrganizationId = "org-work";
  const Component = Route.options.component as ComponentType;
  render(<Component />);
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Start switch" }));
  expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Finish switch" }));
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(state.approve).toHaveBeenCalledWith("CODE");
});
