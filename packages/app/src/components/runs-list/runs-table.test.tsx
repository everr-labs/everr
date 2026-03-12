import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RunsTable } from "./runs-table";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    let href = to;

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value);
      }
    }

    if (search && Object.keys(search).length > 0) {
      href = `${href}?${new URLSearchParams(search).toString()}`;
    }

    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

describe("RunsTable", () => {
  it("renders readable active status text and uses external links for active runs", () => {
    render(
      <RunsTable
        data={[
          {
            runId: "42",
            workflowName: "Deploy",
            repo: "everr-labs/everr",
            branch: "main",
            status: "in_progress",
            conclusion: "",
            duration: 45_000,
            timestamp: "2026-03-10T14:00:00Z",
            sender: "",
            jobCount: 0,
            htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          },
        ]}
      />,
    );

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "42" })).toHaveAttribute(
      "href",
      "https://github.com/everr-labs/everr/actions/runs/42",
    );
    expect(screen.getByRole("link", { name: "42" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("keeps completed runs linked to dashboard details", () => {
    render(
      <RunsTable
        data={[
          {
            traceId: "trace-1",
            runId: "41",
            runAttempt: 2,
            workflowName: "CI",
            repo: "everr-labs/everr",
            branch: "main",
            status: "completed",
            conclusion: "success",
            duration: 12_000,
            timestamp: "2026-03-10T14:00:00Z",
            sender: "octocat",
            jobCount: 4,
          },
        ]}
      />,
    );

    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "41(#2)" })).toHaveAttribute(
      "href",
      "/dashboard/runs/trace-1",
    );
  });
});
