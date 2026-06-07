import { create } from "zustand";
import type { Dashboard, GridLayout, Panel, Variable } from "./schema";

interface DashboardState {
  dashboard: Dashboard | null;
  isEditing: boolean;
  isDirty: boolean;
  /** Slug the dashboard was loaded from (DB row identity); null = unsaved draft. */
  sourceSlug: string | null;
  /** Load/replace the dashboard from server data; resets dirty state. */
  setDashboard: (d: Dashboard, opts?: { draft?: boolean }) => void;
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
  updateVariables: (variables: Variable[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  isEditing: false,
  isDirty: false,
  sourceSlug: null,

  setDashboard: (dashboard, opts) =>
    set({
      dashboard,
      isDirty: false,
      sourceSlug: opts?.draft ? null : dashboard.metadata.name,
    }),
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
  markSaved: () =>
    set((state) => ({
      isDirty: false,
      sourceSlug: state.dashboard?.metadata.name ?? null,
    })),
  reset: () =>
    set({
      dashboard: null,
      isEditing: false,
      isDirty: false,
      sourceSlug: null,
    }),
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

  updateVariables: (variables) =>
    set((state) => {
      if (!state.dashboard) return state;
      return {
        isDirty: true,
        dashboard: {
          ...state.dashboard,
          spec: { ...state.dashboard.spec, variables },
        },
      };
    }),
}));
