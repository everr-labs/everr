import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { CC_POLL_INTERVAL_MS, ccQueries } from "@/data/cc/queries";
import { AlertEventFeed } from "./alert-event-feed";

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

/** Settled event-history query returning `data` (the only axis tests vary). */
function mockHistory(data: AlertEventLogRow[]) {
  mockUseQuery.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
  });
}

beforeEach(() => {
  mockUseQuery.mockReset();
  mockHistory([]);
});

describe("AlertEventFeed", () => {
  it("polls the event-history query so the feed stays current", () => {
    const opts = ccQueries.eventHistory({ from: "now-1h", to: "now" });
    expect(opts.refetchInterval).toBe(CC_POLL_INTERVAL_MS);
  });

  it("shows all events when unscoped", () => {
    mockHistory([historyRow({ slug: "alpha" }), historyRow({ slug: "beta" })]);

    render(<AlertEventFeed />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("filters to scopeSlug, hiding other slugs", () => {
    mockHistory([historyRow({ slug: "alpha" }), historyRow({ slug: "beta" })]);

    render(<AlertEventFeed scopeSlug={["alpha"]} />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("renders evidence chips for a row that carries evidence", () => {
    mockHistory([
      historyRow({
        slug: "beta",
        evidence: { status_code: 500 },
        evidenceTruncated: false,
      }),
    ]);

    render(<AlertEventFeed />);

    expect(screen.getByText("status_code=500")).toBeInTheDocument();
  });

  it("hints at truncation when evidenceTruncated is set", () => {
    mockHistory([
      historyRow({
        slug: "beta",
        evidence: { status_code: 500 },
        evidenceTruncated: true,
      }),
    ]);

    render(<AlertEventFeed />);

    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it("renders the suppressed marker for a suppressed row", () => {
    mockHistory([historyRow({ slug: "beta", suppressed: true })]);

    render(<AlertEventFeed />);

    expect(screen.getByText("suppressed")).toBeInTheDocument();
  });

  it("renders no evidence chips for a row without evidence", () => {
    mockHistory([historyRow({ slug: "beta", evidence: null })]);

    render(<AlertEventFeed />);

    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it("filters by event type, hiding non-matching rows", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "delivery" }),
      historyRow({ slug: "delta", eventType: "rule_health" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed />);
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.getByText("delta")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Delivery" }));

    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
  });

  it("hides the type lens unless showTypeLens is set", () => {
    render(<AlertEventFeed />);

    expect(
      screen.queryByRole("group", { name: "Event kind" }),
    ).not.toBeInTheDocument();
  });

  it("type lens narrows to the lens's event types", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "instance_resolved" }),
      historyRow({ slug: "delta", eventType: "delivery" }),
      historyRow({ slug: "epsilon", eventType: "silenced" }),
      historyRow({ slug: "zeta", eventType: "rule_health" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed showTypeLens />);

    await user.click(screen.getByRole("button", { name: "Transitions" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();
    expect(screen.queryByText("epsilon")).not.toBeInTheDocument();
    expect(screen.queryByText("zeta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deliveries" }));
    expect(screen.getByText("delta")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Silence audits" }));
    expect(screen.getByText("epsilon")).toBeInTheDocument();
    expect(screen.queryByText("delta")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("zeta")).toBeInTheDocument();
  });

  it("type lens composes AND with the fine event-type filter", async () => {
    mockHistory([
      historyRow({ slug: "beta", eventType: "instance_fired" }),
      historyRow({ slug: "gamma", eventType: "instance_resolved" }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed showTypeLens />);

    await user.click(screen.getByRole("button", { name: "Transitions" }));
    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Resolved" }));

    expect(screen.getByText("gamma")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("resolves rule handles to display names via resolveRuleName", () => {
    mockHistory([historyRow({ slug: "beta" })]);

    render(
      <AlertEventFeed
        resolveRuleName={(handle) =>
          handle === "beta" ? "Beta errors" : handle
        }
      />,
    );

    expect(screen.getByText("Beta errors")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("composes the event-type filter with severity (AND)", async () => {
    mockHistory([
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
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed />);

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Fired" }));
    // Both fired rows survive the event-type filter alone.
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
    mockHistory([historyRow({ slug: "beta" })]);

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
    // The type filter survives: a scoped feed still narrows by event kind.
    expect(
      screen.getByRole("combobox", { name: "Event type" }),
    ).toBeInTheDocument();
  });

  it("keeps the full column set (including Severity and Rule) without hideRuleColumns", () => {
    mockHistory([historyRow({ slug: "beta" })]);

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
    mockHistory([
      historyRow({
        slug: "beta",
        eventType: "instance_fired",
        severity: "", // CC doesn't stamp alert.severity on stored records yet
      }),
    ]);

    render(
      <AlertEventFeed
        resolveRuleSeverity={(handle) =>
          handle === "beta" ? "critical" : undefined
        }
      />,
    );

    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it('leaves a genuine data gap as "—" for a non-transition event kind, even with resolveRuleSeverity available', () => {
    mockHistory([
      historyRow({
        slug: "beta",
        eventType: "delivery",
        severity: "",
      }),
    ]);

    render(<AlertEventFeed resolveRuleSeverity={() => "critical"} />);

    // A delivery record carries no status, so it isn't a fire/resolve
    // transition: no rule-severity fallback applies, and the gap is real.
    expect(screen.queryByText("critical")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
