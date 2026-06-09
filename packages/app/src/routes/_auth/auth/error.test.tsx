import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeSearch = vi.hoisted(() => ({
  value: {} as { error?: string },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
      options,
      useSearch: () => routeSearch.value,
    }),
    Link: (props: { to: string; className?: string; children: ReactNode }) => (
      <a href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  };
});

import { Route } from "./error";

describe("/auth/error route", () => {
  beforeEach(() => {
    routeSearch.value = {};
  });

  it("renders a clear message for Google email mismatch errors", () => {
    routeSearch.value = { error: "email_doesn't_match" };
    const Component = Route.options.component as React.ComponentType;

    render(<Component />);

    expect(screen.getByText("Google account mismatch")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The Google account you selected uses a different email than the Everr account you are trying to use.",
      ),
    ).toBeInTheDocument();
    const backHomeLink = screen.getByRole("link", { name: "Back home" });
    expect(backHomeLink).toHaveAttribute("href", "/");
    expect(screen.queryByText("Back to account settings")).toBeNull();
    expect(screen.queryByText("Sign in")).toBeNull();
  });

  it("renders a fallback message for unknown auth errors", () => {
    routeSearch.value = { error: "state_mismatch" };
    const Component = Route.options.component as React.ComponentType;

    render(<Component />);

    expect(screen.getByText("Authentication failed")).toBeInTheDocument();
    expect(screen.getByText("state_mismatch")).toBeInTheDocument();
  });
});
