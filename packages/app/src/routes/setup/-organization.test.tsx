import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => {
  let loaderData: { user: { email?: string } } = {
    user: { email: "user@example.com" },
  };

  return {
    navigate: vi.fn(),
    redirect: vi.fn((args: unknown) => args),
    setLoaderData: (data: { user: { email?: string } }) => {
      loaderData = data;
    },
    getLoaderData: () => loaderData,
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => routerMocks.getLoaderData(),
  }),
  redirect: routerMocks.redirect,
  useNavigate: () => routerMocks.navigate,
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: vi.fn(),
  getSignInUrl: vi.fn(),
}));

vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/data/onboarding", () => ({
  createOrganizationForCurrentUser: vi.fn(),
}));

import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { createOrganizationForCurrentUser } from "@/data/onboarding";
import { Route } from "./organization";

const mockedGetAuth = vi.mocked(getAuth);
const mockedGetSignInUrl = vi.mocked(getSignInUrl);
const mockedCreateOrganization = vi.mocked(createOrganizationForCurrentUser);

describe("/setup/organization route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMocks.setLoaderData({ user: { email: "user@example.com" } });
  });

  describe("loader", () => {
    it("redirects unauthenticated users to sign-in with return path", async () => {
      mockedGetAuth.mockResolvedValue({ user: null } as never);
      mockedGetSignInUrl.mockResolvedValue(
        "https://auth.example/sign-in" as never,
      );

      await expect(
        (Route.options.loader as () => Promise<unknown>)(),
      ).rejects.toEqual({ href: "https://auth.example/sign-in" });

      expect(mockedGetSignInUrl).toHaveBeenCalledWith({
        data: "/setup/organization",
      });
    });

    it("redirects users with active org to dashboard", async () => {
      mockedGetAuth.mockResolvedValue({
        user: { id: "user_123", email: "user@example.com" },
        organizationId: "org_123",
      } as never);

      await expect(
        (Route.options.loader as () => Promise<unknown>)(),
      ).rejects.toEqual({ to: "/dashboard" });
    });

    it("returns user data when authenticated without organization", async () => {
      mockedGetAuth.mockResolvedValue({
        user: { id: "user_123", email: "user@example.com" },
        organizationId: undefined,
      } as never);

      const result = await (Route.options.loader as () => Promise<unknown>)();

      expect(result).toEqual({
        user: { id: "user_123", email: "user@example.com" },
      });
    });
  });

  describe("component", () => {
    it("creates org and navigates to dashboard", async () => {
      const user = userEvent.setup();
      mockedCreateOrganization.mockResolvedValue({
        organizationId: "org_new",
        organizationName: "Acme",
      } as never);

      const Component = Route.options.component as React.ComponentType;
      render(<Component />);

      await user.type(screen.getByLabelText("Organization name"), "Acme");
      await user.click(
        screen.getByRole("button", { name: "Create organization" }),
      );

      expect(mockedCreateOrganization).toHaveBeenCalledWith({
        data: { organizationName: "Acme" },
      });
      expect(routerMocks.navigate).toHaveBeenCalledWith({ to: "/dashboard" });
    });

    it("shows server error and does not navigate when setup API fails", async () => {
      const user = userEvent.setup();
      mockedCreateOrganization.mockRejectedValue(
        new Error("Session switch failed"),
      );

      const Component = Route.options.component as React.ComponentType;
      render(<Component />);

      await user.type(screen.getByLabelText("Organization name"), "Acme");
      await user.click(
        screen.getByRole("button", { name: "Create organization" }),
      );

      expect(screen.getByText("Session switch failed")).toBeInTheDocument();
      expect(routerMocks.navigate).not.toHaveBeenCalled();
    });

    it("shows server error when organization creation fails", async () => {
      const user = userEvent.setup();
      mockedCreateOrganization.mockRejectedValue(
        new Error("Backend unavailable"),
      );

      const Component = Route.options.component as React.ComponentType;
      render(<Component />);

      await user.type(screen.getByLabelText("Organization name"), "Acme");
      await user.click(
        screen.getByRole("button", { name: "Create organization" }),
      );

      expect(screen.getByText("Backend unavailable")).toBeInTheDocument();
      expect(routerMocks.navigate).not.toHaveBeenCalled();
    });

    it("prevents duplicate submissions while request is in-flight", async () => {
      const user = userEvent.setup();
      let resolveRequest: ((value: unknown) => void) | undefined;
      mockedCreateOrganization.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }) as never,
      );

      const Component = Route.options.component as React.ComponentType;
      render(<Component />);

      await user.type(screen.getByLabelText("Organization name"), "Acme");
      const submitButton = screen.getByRole("button", {
        name: "Create organization",
      });

      await user.click(submitButton);
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Creating organization..." }),
        ).toBeDisabled();
      });

      await user.click(
        screen.getByRole("button", { name: "Creating organization..." }),
      );

      expect(mockedCreateOrganization).toHaveBeenCalledTimes(1);

      resolveRequest?.({ organizationId: "org_new", organizationName: "Acme" });
    });
  });
});
