import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { AlertEventFeed } from "./alert-event-feed";

// Avoid loading the database and environment chain under jsdom.
vi.mock("@/db/client", () => ({ db: {} }));

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
    inhibited: false,
    deliveryTargets: [],
    evidence: null,
    evidenceTruncated: false,
    ...overrides,
  };
}

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
  it("drops rows outside scopeSlug even when the read returns them", () => {
    // The query narrows server-side, but a shared cache entry can hand back a
    // wider result, so the feed filters again on its own handles.
    mockHistory([
      historyRow({ slug: "alpha", labels: { team: "mine" } }),
      historyRow({ slug: "beta", labels: { team: "theirs" } }),
    ]);

    render(<AlertEventFeed scopeSlug={["alpha"]} />);

    expect(screen.getByText("mine")).toBeInTheDocument();
    expect(screen.queryByText("theirs")).not.toBeInTheDocument();
  });

  it("scopes the query to every handle it was given", () => {
    render(<AlertEventFeed scopeSlug={["rule-id", "default/beta", "beta"]} />);

    // The key sorts the handles, so callers passing the same set in a
    // different order share one cache entry.
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining([
          expect.objectContaining({
            slugs: ["beta", "default/beta", "rule-id"],
          }),
        ]),
      }),
    );
  });

  it("narrows to one event type and says so when nothing matches", async () => {
    mockHistory([
      historyRow({ eventType: "instance_fired", labels: { team: "fired" } }),
      historyRow({ eventType: "delivery", labels: { team: "delivered" } }),
    ]);
    const user = userEvent.setup();

    render(<AlertEventFeed scopeSlug={["beta"]} />);

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(await screen.findByRole("option", { name: "Fired" }));
    expect(screen.getByText("fired")).toBeInTheDocument();
    expect(screen.queryByText("delivered")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Event type" }));
    await user.click(
      await screen.findByRole("option", { name: "Rule health" }),
    );
    expect(
      await screen.findByText("No Rule health events"),
    ).toBeInTheDocument();
  });

  it("marks a suppressed row as suppressed", () => {
    mockHistory([historyRow({ suppressed: true })]);

    render(<AlertEventFeed scopeSlug={["beta"]} />);

    expect(screen.getByText("suppressed")).toBeInTheDocument();
  });

  it("reports a failed read instead of an empty feed", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("clickhouse down"),
    });

    render(<AlertEventFeed scopeSlug={["beta"]} />);

    expect(screen.getByText(/Event history unavailable/)).toBeInTheDocument();
  });
});
