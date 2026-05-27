import { create } from "zustand";
import type { Dashboard, GridLayout, Panel } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  isEditing: boolean;
  setDashboard: (d: Dashboard) => void;
  setEditing: (editing: boolean) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  isEditing: false,

  setDashboard: (dashboard) => set({ dashboard }),
  setEditing: (isEditing) => set({ isEditing }),

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
