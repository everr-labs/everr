import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import {
  AlertEventFeed,
  type CcRuleFacts,
  ccEventHistoryQueryOptions,
} from "./alert-event-feed";

// ---------------------------------------------------------------------------
// Mocks: the stored-history query. `vi.mock` calls are hoisted above the
// imports above by vitest, so the mocked modules are in place before
// AlertEventFeed (and its dependencies) load.
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQuery: (opts: unknown) => mockUseQuery(opts) };
});

vi.mock("@/hooks/use-time-range", () => ({
  useTimeRange: () => ({
    timeRange: { from: "now-1h", to: "now" },
    setTimeRange: vi.fn(),
  }),
}));

// The Rule column links to the rule detail page; the feed renders outside a
// router here, so Link becomes a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    title,
  }: {
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href="#rule" className={className} title={title}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function historyRow(
  overrides: Partial<AlertEventLogRow> = {},
): AlertEventLogRow {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    eventType: "instance_fired",
    slug: "beta",
    instanceFingerprint: "fp-beta",
    labels: { team: "core" },
    severity: "warning",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: null,
    evidenceTruncated: false,
    ...overrides,
  };
}

function betaFacts(overrides: Partial<CcRuleFacts> = {}): CcRuleFacts {
  return {
    id: "rule-beta",
    name: "Beta errors",
    severity: "critical",
    titleTemplate: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockUseQuery.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  });
});

describe("AlertEventFeed", () => {
  it("polls the event-history query so the feed stays current", () => {
    const opts = ccEventHistoryQueryOptions({ from: "now-1h", to: "now" });
    expect(opts.refetchInterval).toBe(15_000);
  });

  it("shows all events when unscoped", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "alpha" }), historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("filters to scopeSlug, hiding other slugs", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "alpha" }), historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed scopeSlug="alpha" />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("renders evidence chips for a row that carries evidence", () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          evidence: { status_code: 500 },
          evidenceTruncated: false,
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText("status_code=500")).toBeInTheDocument();
  });

  it("summarizes a transition in the rule's notification words when a template resolves", () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          eventType: "instance_fired",
          labels: { team: "core" },
          evidence: { status_code: 500 },
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <AlertEventFeed
        resolveRule={() =>
          betaFacts({ titleTemplate: "${team} saw ${status_code}s" })
        }
      />,
    );

    // The summary replaces raw evidence chips; the evidence stays reachable
    // in the summary's tooltip.
    const summary = screen.getByText("core saw 500s");
    expect(summary).toHaveAttribute("title", "status_code=500");
    expect(screen.queryByText("status_code=500")).not.toBeInTheDocument();
  });

  it("tells the delivery story with its targets", () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          eventType: "delivery",
          deliveryTargets: ["oncall", "email"],
        }),
        historyRow({ slug: "gamma", eventType: "silenced" }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText(/delivered/)).toBeInTheDocument();
    expect(screen.getByText("oncall, email")).toBeInTheDocument();
    expect(screen.getByText("muted by silence")).toBeInTheDocument();
  });

  it("hints at truncation when evidenceTruncated is set", () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          evidence: { status_code: 500 },
          evidenceTruncated: true,
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it("renders the suppressed marker for a suppressed row", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta", suppressed: true })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText("suppressed")).toBeInTheDocument();
  });

  it("renders no evidence chips for a row without evidence", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta", evidence: null })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it("always renders the type lens as the one event-kind filter", () => {
    render(<AlertEventFeed />);

    expect(
      screen.getByRole("tablist", { name: "Event kind" }),
    ).toBeInTheDocument();
    // The old fine-grained event-type select is gone: one mechanism only.
    expect(
      screen.queryByRole("combobox", { name: "Event type" }),
    ).not.toBeInTheDocument();
  });

  it("type lens narrows to the lens's event type", async () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({ slug: "beta", eventType: "instance_fired" }),
        historyRow({ slug: "gamma", eventType: "instance_resolved" }),
        historyRow({ slug: "delta", eventType: "delivery" }),
        historyRow({ slug: "epsilon", eventType: "silenced" }),
        historyRow({ slug: "zeta", eventType: "rule_health" }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<AlertEventFeed />);

    await user.click(screen.getByRole("tab", { name: "Fired" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Resolved" }));
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Deliveries" }));
    expect(screen.getByText("delta")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Silenced" }));
    expect(screen.getByText("epsilon")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Rule health" }));
    expect(screen.getByText("zeta")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });

  it("resolves rule handles to linked display names via resolveRule", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <AlertEventFeed
        resolveRule={(handle) => (handle === "beta" ? betaFacts() : undefined)}
      />,
    );

    const link = screen.getByRole("link", { name: "Beta errors" });
    expect(link).toHaveAttribute("title", "Beta errors (beta)");
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("composes the type lens with severity (AND)", async () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          eventType: "instance_fired",
          severity: "critical",
        }),
        historyRow({
          slug: "gamma",
          eventType: "instance_fired",
          severity: "warning",
        }),
        historyRow({
          slug: "delta",
          eventType: "delivery",
          severity: "critical",
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });
    const user = userEvent.setup();

    render(<AlertEventFeed />);

    await user.click(screen.getByRole("tab", { name: "Fired" }));
    // Both fired rows survive the lens alone.
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Severity" }));
    await user.click(await screen.findByRole("option", { name: "Critical" }));

    // Only the row matching BOTH filters remains.
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.queryByText("gamma")).not.toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
  });

  it("hideRuleColumns drops the Severity and Rule columns and the severity filter", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed hideRuleColumns />);

    expect(
      screen.queryByRole("columnheader", { name: "Severity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Rule" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Severity" }),
    ).not.toBeInTheDocument();
    // The row's own slug ("beta") no longer renders anywhere: it was the
    // Rule column's content.
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    // The type lens survives: a scoped feed still narrows by event kind.
    expect(
      screen.getByRole("tablist", { name: "Event kind" }),
    ).toBeInTheDocument();
  });

  it("keeps the full column set (including Severity and Rule) without hideRuleColumns", () => {
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(
      screen.getByRole("columnheader", { name: "Severity" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Rule" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Severity" }),
    ).toBeInTheDocument();
  });

  it("falls back to the rule's severity for a fire/resolve transition whose own severity is a stored-history gap", () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          eventType: "instance_fired",
          severity: "", // CC doesn't stamp alert.severity on stored records yet
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(
      <AlertEventFeed
        resolveRule={(handle) => (handle === "beta" ? betaFacts() : undefined)}
      />,
    );

    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it('leaves a genuine data gap as "—" for a non-transition event kind, even with resolveRule available', () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({
          slug: "beta",
          eventType: "delivery",
          severity: "",
        }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed resolveRule={() => betaFacts()} />);

    // A delivery record carries no status, so it isn't a fire/resolve
    // transition: no rule-severity fallback applies, and the gap is real.
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
