import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { CcSlo, CcSloGroupStatus } from "@/data/cc/types";
import { CcSloPostureCard } from "./slo-posture";

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: "slo-1",
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

function group(overrides: Partial<CcSloGroupStatus> = {}): CcSloGroupStatus {
  return {
    labels: {},
    sli: 0.999,
    budget_remaining: 0.5,
    time_to_exhaustion_secs: null,
    tiers: [],
    firing_tiers: [],
    ...overrides,
  };
}

/**
 * A snapshot tier reporting a confirmed burn. `ccSloCurrentBurn` only claims a
 * rate when BOTH windows have data, so both are set; the name must match a spec
 * tier (canonical, for a 30d window) or the snapshot is ignored entirely.
 */
function tier(long: number | null, short: number | null) {
  return {
    name: "fast-burn",
    long_burn_rate: long,
    short_burn_rate: short,
    long_window_valid: null,
  };
}

/** The card renders TanStack Router <Link>s, so it needs a router in scope. */
function renderCard(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/alerts"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("CcSloPostureCard time to exhaustion", () => {
  it("forecasts a duration when the engine gives one", async () => {
    renderCard(
      <CcSloPostureCard
        pending={false}
        posture={[
          {
            slo: ccSlo(),
            statusPending: false,
            worst: group({
              budget_remaining: 0.25,
              time_to_exhaustion_secs: 14_400,
              tiers: [tier(2.5, 2.5)],
            }),
            firing: [],
          },
        ]}
      />,
    );

    expect(await screen.findByText("4h")).toBeInTheDocument();
  });

  it("says exhausted when the budget is spent, whatever the forecast", async () => {
    renderCard(
      <CcSloPostureCard
        pending={false}
        posture={[
          {
            slo: ccSlo(),
            statusPending: false,
            worst: group({
              budget_remaining: 0,
              time_to_exhaustion_secs: null,
              tiers: [tier(9, 9)],
            }),
            firing: [],
          },
        ]}
      />,
    );

    expect(await screen.findByText("exhausted")).toBeInTheDocument();
  });

  it("says not shrinking when there is budget and nothing is burning", async () => {
    renderCard(
      <CcSloPostureCard
        pending={false}
        posture={[
          {
            slo: ccSlo(),
            statusPending: false,
            worst: group({
              budget_remaining: 0.9,
              time_to_exhaustion_secs: null,
              tiers: [tier(0, 0)],
            }),
            firing: [],
          },
        ]}
      />,
    );

    expect(await screen.findByText("not shrinking")).toBeInTheDocument();
  });

  it("says nothing definite when the engine has no answer at all", async () => {
    // No confirmed burn (one window without data) and no forecast: the row must
    // not invent "not shrinking", which would claim the budget is holding.
    renderCard(
      <CcSloPostureCard
        pending={false}
        posture={[
          {
            slo: ccSlo(),
            statusPending: false,
            worst: group({
              budget_remaining: 0.9,
              time_to_exhaustion_secs: null,
              tiers: [tier(3, null)],
            }),
            firing: [],
          },
        ]}
      />,
    );

    expect(await screen.findByTitle("Time to exhaustion")).toHaveTextContent(
      "—",
    );
    expect(screen.queryByText("not shrinking")).not.toBeInTheDocument();
  });

  it("prompts for an as-code SLO when there are none", async () => {
    renderCard(<CcSloPostureCard pending={false} posture={[]} />);
    expect(await screen.findByText(/No SLOs yet/)).toBeInTheDocument();
    expect(screen.getByText("everr apply")).toBeInTheDocument();
  });
});
