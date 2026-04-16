import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

import { Route } from "./account";

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
});
