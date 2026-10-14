import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("@/data/organizations", () => ({ createOrganization: create }));
vi.mock("@/components/use-organization-activation", () => ({
  useOrganizationActivation: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/data/organization-provisioning", () => ({
  completeOrganizationSetup: vi.fn(),
  getOrganizationProvisioningStatus: vi.fn(),
  retryOrganizationProvisioning: vi.fn(),
}));

import { OrganizationCreation } from "@/components/organization-creation";

it("creates an organization without showing or submitting a commercial plan", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrganizationCreation canCreateHobby={false} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Hobby")).toBeNull();
  expect(screen.queryByText("Pro")).toBeNull();
  expect(screen.queryByText("Continue to checkout")).toBeNull();
  fireEvent.change(screen.getByLabelText("Organization name"), {
    target: { value: "Acme" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      data: { organizationName: "Acme", returnTo: "/", plan: undefined },
    }),
  );
  expect(
    screen.getByRole("heading", { name: "Getting your space ready" }),
  ).toBeVisible();
});
