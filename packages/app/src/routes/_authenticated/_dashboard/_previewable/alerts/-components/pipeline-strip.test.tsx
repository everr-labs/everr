import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  type AlertingPipelineFacts,
  AlertingPipelineStrip,
} from "./pipeline-strip";

const FACTS: AlertingPipelineFacts = {
  watchingRules: 4,
  pausedRules: 1,
  watchingSlos: 2,
  firing: 3,
  pending: 1,
  silenced: 2,
  activeSilences: 1,
  routeCount: 2,
  receiverCount: 3,
  unroutedFiring: 0,
};

function renderStrip(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/alerts"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("AlertingPipelineStrip", () => {
  it("reads out all four stages", async () => {
    renderStrip(<AlertingPipelineStrip facts={FACTS} />);
    const strip = await screen.findByRole("region", {
      name: "Alerting pipeline",
    });

    expect(strip).toHaveTextContent("4 rules · 2 SLOs");
    expect(strip).toHaveTextContent("1 paused");
    expect(strip).toHaveTextContent("1 pending");
    expect(strip).toHaveTextContent("1 active silence");
    expect(strip).toHaveTextContent("2 routes → 3 receivers");
  });

  it("is a readout: no cell navigates or acts", async () => {
    renderStrip(<AlertingPipelineStrip facts={FACTS} />);
    const strip = await screen.findByRole("region", {
      name: "Alerting pipeline",
    });

    // Four identical-looking cards where some navigate away and others filter
    // in place would be several affordances wearing one costume. Filtering is
    // the board's segmented control; navigation is the sidebar.
    expect(within(strip).queryAllByRole("link")).toHaveLength(0);
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
  });

  it("flags unrouted firing instances on the Notifying stage", async () => {
    renderStrip(
      <AlertingPipelineStrip facts={{ ...FACTS, unroutedFiring: 3 }} />,
    );
    expect(await screen.findByText("3 firing unrouted")).toBeInTheDocument();
  });

  it("says all quiet when nothing is firing or pending", async () => {
    renderStrip(
      <AlertingPipelineStrip facts={{ ...FACTS, firing: 0, pending: 0 }} />,
    );
    expect(await screen.findByText("all quiet")).toBeInTheDocument();
  });
});
