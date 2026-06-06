import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlertsPage } from "./alerts-page";

const rule = {
  id: 42,
  service: "api",
  name: "high-5xx-routes",
  severity: "critical" as const,
  routingSlug: "admins",
  evaluationIntervalSeconds: 60,
  windowSeconds: 300,
  active: true,
  sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
  lastEvaluationStatus: "success",
  lastEvaluationError: null,
  stateStatus: "firing" as const,
  updatedAt: "2026-06-06T12:00:00.000Z",
};

const activeAlert = {
  alertDefinitionId: 42,
  service: "api",
  name: "high-5xx-routes",
  severity: "critical" as const,
  routingSlug: "admins",
  status: "firing" as const,
  firstFiredAt: "2026-06-06T12:00:00.000Z",
  lastSeenAt: "2026-06-06T12:05:00.000Z",
  rowCount: 2,
  evidence: [{ route: "/api", error_count: 12 }],
  evidenceTruncated: false,
  sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
};

const event = {
  id: 100,
  alertDefinitionId: 42,
  service: "api",
  name: "high-5xx-routes",
  severity: "critical" as const,
  type: "firing" as const,
  summary: "2 routes have elevated 5xxs",
  description: "Top route: /api",
  occurredAt: "2026-06-06T12:05:00.000Z",
  rowCount: 2,
  sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
};

const routingList = {
  slug: "admins",
  name: "Admins",
  builtIn: true,
  members: [
    {
      userId: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "admin",
    },
  ],
};

describe("AlertsPage", () => {
  it("renders alert tabs and admin actions", async () => {
    const user = userEvent.setup();
    const onDeactivateRule = vi.fn();
    const onSaveRoutingList = vi.fn();

    render(
      <AlertsPage
        rules={[rule]}
        activeAlerts={[activeAlert]}
        events={[event]}
        routingLists={[routingList]}
        canManage
        onDeactivateRule={onDeactivateRule}
        onSaveRoutingList={onSaveRoutingList}
      />,
    );

    expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText("api / high-5xx-routes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      rule.sourceUrl,
    );

    await user.click(screen.getByRole("tab", { name: "Active alerts" }));
    expect(screen.getByText("2 matching rows")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText("2 routes have elevated 5xxs")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Routing lists" }));
    const routingRegion = screen.getByRole("tabpanel", {
      name: "Routing lists",
    });
    expect(within(routingRegion).getByText("Ada Lovelace")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Rules" }));
    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(onDeactivateRule).toHaveBeenCalledWith(42);
  });

  it("hides mutation controls for non-admin users", () => {
    render(
      <AlertsPage
        rules={[rule]}
        activeAlerts={[]}
        events={[]}
        routingLists={[routingList]}
        canManage={false}
        onDeactivateRule={vi.fn()}
        onSaveRoutingList={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
  });
});
