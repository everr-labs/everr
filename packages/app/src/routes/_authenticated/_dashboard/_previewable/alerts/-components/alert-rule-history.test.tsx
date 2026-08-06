import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AlertingRuleEvaluationSeries } from "@/data/alerting/types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { AlertRuleHistory } from "./alert-rule-history";

// Shared alerting presentation helpers import query modules, but this component
// test never crosses the database boundary.
vi.mock("@/db/client", () => ({ db: {} }));

const condition = { operator: "gte" as const, threshold: 2 };

function evaluationSeries(): AlertingRuleEvaluationSeries {
  const point = {
    t: "2026-08-06T12:00:00Z",
    samples: [
      { fingerprint: "api", labels: { source: "api" }, value: 1 },
      { fingerprint: "worker", labels: { source: "worker" }, value: 2 },
    ],
    failed: false,
    error: null,
    row_count: 2,
  };
  return {
    points: [point],
    recent_points: [point],
    evaluation_count: 1,
    samples_truncated: false,
  };
}

function eventRow(overrides: Partial<AlertEventLogRow> = {}): AlertEventLogRow {
  return {
    timestamp: "2026-08-06T12:01:00Z",
    eventType: "instance_fired",
    slug: "demo/rule",
    instanceFingerprint: "worker",
    labels: { source: "worker" },
    severity: "critical",
    suppressed: false,
    silenced: false,
    inhibited: false,
    deliveryTargets: [],
    evidence: { value: 2 },
    evidenceTruncated: false,
    ...overrides,
  };
}

function renderHistory(
  overrides: Partial<ComponentProps<typeof AlertRuleHistory>> = {},
) {
  return render(
    <AlertRuleHistory
      evaluationSeries={evaluationSeries()}
      evaluationPending={false}
      evaluationError={null}
      condition={condition}
      events={[eventRow()]}
      eventsPending={false}
      eventsError={null}
      {...overrides}
    />,
  );
}

describe("AlertRuleHistory", () => {
  it("shows the compact evaluation table by default", () => {
    renderHistory();

    expect(
      screen.getByRole("heading", { name: "History" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Evaluations" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("1/2 breached")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Rows" }),
    ).toBeInTheDocument();
  });

  it("switches to compact event rows", async () => {
    const user = userEvent.setup();
    renderHistory({
      events: [
        eventRow(),
        eventRow({
          timestamp: "2026-08-06T12:02:00Z",
          eventType: "instance_resolved",
          instanceFingerprint: "api",
          labels: { source: "api" },
          evidence: null,
        }),
      ],
    });

    await user.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByText("Fired")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("worker")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps event flags visible in the compact details column", async () => {
    const user = userEvent.setup();
    renderHistory({
      events: [eventRow({ suppressed: true })],
    });

    await user.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByText("Suppressed")).toBeInTheDocument();
  });

  it("reports event-history failures inside the merged card", async () => {
    const user = userEvent.setup();
    renderHistory({ eventsError: new Error("postgres unavailable") });

    await user.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByText(/Event history unavailable/)).toBeInTheDocument();
  });
});
