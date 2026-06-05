import { create } from "zustand";
import type { Dashboard, GridLayout, Panel } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  isEditing: boolean;
  isDirty: boolean;
  /** Load/replace the dashboard from server data; resets dirty state. */
  setDashboard: (d: Dashboard) => void;
  /** Replace the dashboard with a locally edited version; marks dirty. */
  patchDashboard: (d: Dashboard) => void;
  /** Update the display name without touching dirty state (rename saves server-side). */
  updateDisplayName: (name: string) => void;
  /** Clear dirty state after a successful save. */
  markSaved: () => void;
  /** Clear the store entirely (used when discarding unsaved changes). */
  reset: () => void;
  setEditing: (editing: boolean) => void;
  updatePanel: (key: string, panel: Panel) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  isEditing: false,
  isDirty: false,

  setDashboard: (dashboard) => set({ dashboard, isDirty: false }),
  patchDashboard: (dashboard) => set({ dashboard, isDirty: true }),
  updateDisplayName: (name) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        dashboard: {
          ...state.dashboard,
          spec: {
            ...state.dashboard.spec,
            display: { ...state.dashboard.spec.display, name },
          },
        },
      };
    }),
  markSaved: () => set({ isDirty: false }),
  reset: () => set({ dashboard: null, isEditing: false, isDirty: false }),
  setEditing: (isEditing) => set({ isEditing }),

  updatePanel: (key, panel) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        isDirty: true,
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
        isDirty: true,
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, layouts },
        },
      };
    }),
}));
