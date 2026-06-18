import { createContext, type ReactNode, useContext } from "react";
import type { Dashboard } from "@/data/dashboards/schema";

const DashboardContext = createContext<Dashboard | null>(null);

/**
 * Provides the Dashboard-shaped document that drives the panel machinery
 * (variables, panel queries, the variable bar). The dashboard route provides
 * the fetched dashboard; the notebook viewer provides an adapted document
 * (see data/notebooks/pages.ts toDashboardDocument).
 *
 * The document is immutable (gitops, read-only): the route reads it from the
 * react-query cache as the single source of truth and passes it down here, so
 * multiple consumers share one entry without a separate store.
 */
export function DashboardProvider({
  document,
  children,
}: {
  document: Dashboard;
  children: ReactNode;
}) {
  return (
    <DashboardContext.Provider value={document}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): Dashboard {
  const dashboard = useContext(DashboardContext);
  if (!dashboard) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return dashboard;
}
