import { create } from "zustand";
import type { Dashboard } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  /** Identity the dashboard was loaded from, "source/slug"; null = none. */
  loadedKey: string | null;
  setDashboard: (d: Dashboard, key: string) => void;
  reset: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  loadedKey: null,
  setDashboard: (dashboard, key) => set({ dashboard, loadedKey: key }),
  reset: () => set({ dashboard: null, loadedKey: null }),
}));
