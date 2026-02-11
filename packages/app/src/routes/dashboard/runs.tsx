import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/runs")({
  staticData: { breadcrumb: "Runs" },
  component: () => <Outlet />,
});
