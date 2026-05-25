import { create } from "zustand";
import type { Dashboard, GridLayout, Panel } from "./types";

interface DashboardState {
  dashboard: Dashboard | null;
  setDashboard: (d: Dashboard) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,

  setDashboard: (dashboard) => set({ dashboard }),

  updatePanel: (key, panel) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        dashboard: {
          ...state.dashboard,
          spec: {
            ...state.dashboard.spec,
            panels: { ...state.dashboard.spec.panels, [key]: panel },
          },
        },
      };
    }),

  updateLayout: (layouts) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, layouts },
        },
      };
    }),
}));
