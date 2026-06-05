import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "./dashboard-store";
import type { Dashboard } from "./schema";

const makeDashboard = (name = "dash-1"): Dashboard => ({
  kind: "Dashboard",
  metadata: { name },
  spec: {
    display: { name: "My Dashboard" },
    panels: {},
    layouts: [{ kind: "Grid", spec: { items: [] } }],
  },
});

const panel = {
  kind: "Panel" as const,
  spec: {
    display: { name: "P" },
    plugin: { kind: "TimeSeriesChart", spec: {} },
  },
};

beforeEach(() => {
  useDashboardStore.setState({
    dashboard: null,
    isEditing: false,
    isDirty: false,
  });
});

describe("dashboard store dirty tracking", () => {
  it("starts clean and setDashboard resets dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    expect(useDashboardStore.getState().isDirty).toBe(false);

    useDashboardStore.getState().updatePanel("panel1", panel);
    expect(useDashboardStore.getState().isDirty).toBe(true);

    useDashboardStore.getState().setDashboard(makeDashboard("dash-2"));
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });

  it("updatePanel marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updatePanel("panel1", panel);
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("updateLayout marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore
      .getState()
      .updateLayout([{ kind: "Grid", spec: { items: [] } }]);
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("patchDashboard replaces the dashboard and marks dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().patchDashboard(makeDashboard("patched"));
    expect(useDashboardStore.getState().isDirty).toBe(true);
    expect(useDashboardStore.getState().dashboard?.metadata.name).toBe(
      "patched",
    );
  });

  it("markSaved clears dirty", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().markSaved();
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });

  it("updateDisplayName preserves the current dirty state", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().updateDisplayName("Renamed");
    expect(useDashboardStore.getState().isDirty).toBe(false);
    expect(useDashboardStore.getState().dashboard?.spec.display?.name).toBe(
      "Renamed",
    );

    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().updateDisplayName("Renamed again");
    expect(useDashboardStore.getState().isDirty).toBe(true);
  });

  it("reset clears everything", () => {
    useDashboardStore.getState().setDashboard(makeDashboard());
    useDashboardStore.getState().setEditing(true);
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().reset();
    const s = useDashboardStore.getState();
    expect(s.dashboard).toBeNull();
    expect(s.isEditing).toBe(false);
    expect(s.isDirty).toBe(false);
  });

  it("noop actions when no dashboard loaded do not mark dirty", () => {
    useDashboardStore.getState().updatePanel("panel1", panel);
    useDashboardStore.getState().updateLayout([]);
    expect(useDashboardStore.getState().isDirty).toBe(false);
  });
});
