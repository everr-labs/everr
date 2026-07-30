import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import type { CcRuleView, CcSlo } from "@/data/cc/types";
import { CcRecentEventsCard } from "./recent-events";

function eventRow(overrides: Partial<AlertEventLogRow> = {}): AlertEventLogRow {
  return {
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    eventType: "instance_fired",
    slug: "flapping",
    instanceFingerprint: "fp-1",
    labels: { host: "web-1" },
    severity: "critical",
    suppressed: false,
    silenced: false,
    deliveryTargets: [],
    evidence: {},
    evidenceTruncated: false,
    ...overrides,
  };
}

function ccRule(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return {
    id: "rule-1",
    tenant: "org1",
    namespace: "",
    name: "default/flapping",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: ["host"],
      value_column: null,
      severity: "critical",
      annotations: { "everr.display.name": "Flapping check" },
      resolve_after: 1,
      suppressed: false,
    },
    version: 1,
    paused: false,
    updated_at: "2026-06-14T12:00:00Z",
    health: {
      status: "healthy",
      consecutive_failures: 0,
      degraded_since: null,
      last_error: null,
      last_error_at: null,
    },
    ...overrides,
  };
}

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    namespace: "",
    name: "default/checkout-availability",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 1,
    paused: false,
    ...overrides,
  };
}

/** Only the four fields the card reads off the query result. */
function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [] as AlertEventLogRow[],
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as never;
}

function renderCard(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/alerts"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("CcRecentEventsCard", () => {
  it("links a rule-sourced row to the rule's detail page by display name", async () => {
    renderCard(
      <CcRecentEventsCard
        events={query({ data: [eventRow()] })}
        slos={[]}
        rules={[ccRule()]}
      />,
    );

    const link = await screen.findByRole("link", { name: "Flapping check" });
    expect(link).toHaveAttribute("href", "/alerts/rules/default/flapping");
    expect(screen.getByText("firing")).toBeInTheDocument();
  });

  it("links an SLO-sourced row to the SLO's detail page", async () => {
    renderCard(
      <CcRecentEventsCard
        events={query({ data: [eventRow({ slug: "checkout-availability" })] })}
        slos={[ccSlo()]}
        rules={[]}
      />,
    );

    const link = await screen.findByRole("link", {
      name: "checkout-availability",
    });
    expect(link).toHaveAttribute(
      "href",
      "/alerts/slos/default/checkout-availability",
    );
  });

  it("renders an unresolved source as plain text, never a dead link", async () => {
    renderCard(
      <CcRecentEventsCard
        events={query({ data: [eventRow({ slug: "since-deleted" })] })}
        slos={[]}
        rules={[]}
      />,
    );

    expect(await screen.findByText("since-deleted")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "since-deleted" }),
    ).not.toBeInTheDocument();
  });

  it("says nothing happened only when the read succeeded", async () => {
    renderCard(<CcRecentEventsCard events={query()} slos={[]} rules={[]} />);
    expect(
      await screen.findByText("No stored events in the last 24h."),
    ).toBeInTheDocument();
  });

  it("reports a failed read instead of a false 'no events'", async () => {
    renderCard(
      <CcRecentEventsCard
        events={query({
          data: undefined,
          isError: true,
          error: new Error("clickhouse down"),
        })}
        slos={[]}
        rules={[]}
      />,
    );

    expect(
      await screen.findByText(/Event history unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No stored events/)).not.toBeInTheDocument();
  });
});
