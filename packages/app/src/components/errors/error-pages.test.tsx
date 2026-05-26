import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ErrorIssueSummary } from "@/data/errors/types";
import { ErrorFilters } from "./error-filters";
import { ErrorIssueList } from "./error-issue-list";

const issue: ErrorIssueSummary = {
  fingerprint: "fp-1",
  exceptionType: "TypeError",
  exceptionMessage: "Cannot read properties of undefined",
  body: "TypeError: Cannot read properties of undefined",
  latestServiceName: "web",
  services: ["web"],
  occurrenceCount: 3,
  traceCount: 2,
  firstSeen: "2026-05-26 10:00:00.000000000",
  lastSeen: "2026-05-26 10:05:00.000000000",
  latestTraceId: "trace-1",
  latestSpanId: "span-1",
  latestTimestamp: "2026-05-26 10:05:00.000000000",
};

describe("ErrorIssueList", () => {
  it("renders grouped issue rows", () => {
    render(
      <ErrorIssueList
        issues={[issue]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        renderIssueLink={({ fingerprint, children }) => (
          <a href={`/errors/${fingerprint}`}>{children}</a>
        )}
      />,
    );

    expect(screen.getByText("TypeError")).toBeInTheDocument();
    expect(
      screen.getByText("Cannot read properties of undefined"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 occurrences")).toBeInTheDocument();
    expect(screen.getByText("2 traces")).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(
      <ErrorIssueList
        issues={[]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        renderIssueLink={({ children }) => <span>{children}</span>}
      />,
    );

    expect(screen.getByText("No exception logs found")).toBeInTheDocument();
  });
});

describe("ErrorFilters", () => {
  const defaultValue = {
    q: "",
    service: [],
    fingerprint: "",
    sort: "lastSeen" as const,
    limit: 50,
  };

  it("submits search text and sort changes", async () => {
    const onChange = vi.fn();
    render(
      <ErrorFilters
        value={defaultValue}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("Search errors"), "boom");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: "boom" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "count" }),
    );
  });

  it("syncs search draft from route state and clears it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ErrorFilters
        value={{ ...defaultValue, q: "boom" }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    const input = screen.getByPlaceholderText("Search errors");
    expect(input).toHaveValue("boom");

    rerender(
      <ErrorFilters
        value={{ ...defaultValue, q: "external" }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );
    expect(input).toHaveValue("external");

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenCalledWith({ q: "" });
  });

  it("toggles service filters", async () => {
    const onChange = vi.fn();
    render(
      <ErrorFilters
        value={{ ...defaultValue, service: ["web"] }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    const web = screen.getByRole("button", { name: "web" });
    const api = screen.getByRole("button", { name: "api" });
    expect(web).toHaveAttribute("aria-pressed", "true");
    expect(api).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(web);
    expect(onChange).toHaveBeenCalledWith({ service: [] });

    await userEvent.click(api);
    expect(onChange).toHaveBeenCalledWith({ service: ["web", "api"] });
  });
});
