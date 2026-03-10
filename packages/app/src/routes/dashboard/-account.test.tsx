import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const authClientMocks = vi.hoisted(() => ({
  accessToken: "access_token_123",
}));

const widgetMocks = vi.hoisted(() => ({
  userProfileProps: [] as Array<{ authToken: string }>,
  userSecurityProps: [] as Array<{ authToken: string }>,
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

vi.mock("@workos/authkit-tanstack-react-start/client", () => ({
  useAccessToken: () => ({
    accessToken: authClientMocks.accessToken,
  }),
}));

vi.mock("@workos-inc/widgets", () => ({
  UserProfile: (props: { authToken: string }) => {
    widgetMocks.userProfileProps.push(props);
    return <div data-testid="user-profile" />;
  },
  UserSecurity: (props: { authToken: string }) => {
    widgetMocks.userSecurityProps.push(props);
    return <div data-testid="user-security" />;
  },
}));

import { Route } from "./account";

describe("/dashboard/account route", () => {
  it("renders WorkOS profile and security widgets", () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(screen.getByText("Account Settings")).toBeInTheDocument();
    expect(screen.getByTestId("user-profile")).toBeInTheDocument();
    expect(screen.getByTestId("user-security")).toBeInTheDocument();
  });

  it("passes the AuthKit access token to both widgets", () => {
    const Component = Route.options.component as React.ComponentType;
    render(<Component />);

    expect(widgetMocks.userProfileProps[0]?.authToken).toBe("access_token_123");
    expect(widgetMocks.userSecurityProps[0]?.authToken).toBe(
      "access_token_123",
    );
  });
});
