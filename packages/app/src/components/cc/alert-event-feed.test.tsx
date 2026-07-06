import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcEvent } from "@/data/cc/types";
import { AlertEventFeed } from "./alert-event-feed";

// ---------------------------------------------------------------------------
// Mocks: the stored-history query and the live event hook. Follows the
// mocking pattern in src/hooks/use-cc-events.test.ts (mock the hook boundary,
// not the transport it wraps). `vi.mock` calls are hoisted above the imports
// above by vitest, so the mocked modules are in place before AlertEventFeed
// (and its dependencies) load.
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

let liveEvents: CcEvent[] = [];
let connected = true;
let paused = false;
const clear = vi.fn(() => {
  liveEvents = [];
});
const setPaused = vi.fn((p: boolean) => {
  paused = p;
});

vi.mock("@/hooks/use-cc-events", () => ({
  useCcEvents: () => ({
    events: liveEvents,
    connected,
    clear,
    setPaused,
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

function liveEvent(overrides: Partial<CcEvent> = {}): CcEvent {
  return {
    tenant: "t1",
    rule: "alpha-rule-id",
    instance_key: "fp-alpha",
    status: "firing",
    labels: { team: "pay" },
    value: null,
    severity: "critical",
    annotations: { "everr.name": "alpha" },
    eval_ts: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

/**
 * Mimics the real useCcEvents hook's onmessage guard (frames are dropped
 * while paused), so simulating a new SSE frame exercises the same contract
 * AlertEventFeed relies on.
 */
function emitLiveEvent(event: CcEvent) {
  if (paused) return;
  liveEvents = [event, ...liveEvents];
}

beforeEach(() => {
  liveEvents = [];
  connected = true;
  paused = false;
  clear.mockClear();
  setPaused.mockClear();
  mockUseQuery.mockReset();
  mockUseQuery.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  });
});

describe("AlertEventFeed", () => {
  it("shows all events when unscoped", () => {
    liveEvents = [liveEvent()];
    mockUseQuery.mockReturnValue({
      data: [historyRow()],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("filters to scopeSlug, hiding other slugs", () => {
    liveEvents = [liveEvent()];
    mockUseQuery.mockReturnValue({
      data: [historyRow({ slug: "beta" })],
      isPending: false,
      isError: false,
      error: null,
    });

    render(<AlertEventFeed scopeSlug="alpha" />);

    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("pause stops new live events from appearing", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AlertEventFeed />);

    emitLiveEvent(liveEvent({ annotations: { "everr.name": "first" } }));
    rerender(<AlertEventFeed />);
    expect(screen.getByText("first")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /pause/i }));
    expect(setPaused).toHaveBeenCalledWith(true);

    emitLiveEvent(liveEvent({ annotations: { "everr.name": "second" } }));
    rerender(<AlertEventFeed />);

    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it("shows the resume control once paused", async () => {
    const user = userEvent.setup();
    render(<AlertEventFeed />);

    await user.click(screen.getByRole("button", { name: /pause/i }));

    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("renders evidence chips for a history row that carries evidence", () => {
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

  it("filters by event type, hiding non-matching rows", async () => {
    mockUseQuery.mockReturnValue({
      data: [
        historyRow({ slug: "beta", eventType: "instance_fired" }),
        historyRow({ slug: "gamma", eventType: "delivery" }),
        historyRow({ slug: "delta", eventType: "rule_health" }),
      ],
      isPending: false,
      isError: false,
      error: null,
    });
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

  it("composes the event-type filter with severity (AND)", async () => {
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
});
