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
  firing: 3,
  pending: 1,
  silenced: 2,
  activeSilences: 1,
  routeCount: 2,
  receiverCount: 3,
  undeliveredFiring: 0,
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
      name: "Alerting overview",
    });

    expect(strip).toHaveTextContent("4 rules");
    expect(strip).toHaveTextContent("1 paused");
    expect(strip).toHaveTextContent("Breaching instances");
    expect(strip).toHaveTextContent("3 firing");
    expect(strip).toHaveTextContent("1 pending");
    expect(strip).toHaveTextContent("1 active silence");
    expect(strip).toHaveTextContent("2 routes · 3 receivers");
  });

  it("shows the watched rule count as plain text, not a link", async () => {
    renderStrip(<AlertingPipelineStrip facts={FACTS} />);
    const strip = await screen.findByRole("region", {
      name: "Alerting overview",
    });

    // The rule inventory this cell used to link to is this same page now.
    expect(
      within(strip).queryByRole("link", { name: "4 rules" }),
    ).not.toBeInTheDocument();
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
  });

  it("flags undelivered firing instances on the Delivery stage", async () => {
    renderStrip(
      <AlertingPipelineStrip facts={{ ...FACTS, undeliveredFiring: 3 }} />,
    );
    expect(await screen.findByText("Coverage incomplete")).toBeInTheDocument();
  });

  it("counts pending and firing instances as breaching", async () => {
    renderStrip(
      <AlertingPipelineStrip facts={{ ...FACTS, firing: 2, pending: 2 }} />,
    );
    const strip = await screen.findByRole("region", {
      name: "Alerting overview",
    });
    const breaching = within(strip)
      .getByText("Breaching instances")
      .closest("div");
    if (!breaching) throw new Error("Breaching summary is missing");
    expect(within(breaching).getByText("4")).toBeInTheDocument();
    expect(breaching).toHaveTextContent("2 firing");
    expect(breaching).toHaveTextContent("2 pending");
  });
});
