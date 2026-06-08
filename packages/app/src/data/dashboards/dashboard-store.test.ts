import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "./dashboard-store";
import type { Dashboard } from "./schema";

const dashboard = (name: string): Dashboard => ({
  kind: "Dashboard",
  metadata: { name },
  spec: { panels: {}, layouts: [] },
});

beforeEach(() => {
  useDashboardStore.setState({ dashboard: null, loadedKey: null });
});

describe("dashboard-store", () => {
  it("setDashboard stores the dashboard and its loaded key", () => {
    useDashboardStore.getState().setDashboard(dashboard("cpu"), "team/cpu");
    expect(useDashboardStore.getState().dashboard?.metadata.name).toBe("cpu");
    expect(useDashboardStore.getState().loadedKey).toBe("team/cpu");
  });

  it("reset clears the store", () => {
    useDashboardStore.getState().setDashboard(dashboard("cpu"), "team/cpu");
    useDashboardStore.getState().reset();
    expect(useDashboardStore.getState().dashboard).toBeNull();
    expect(useDashboardStore.getState().loadedKey).toBeNull();
  });
});
