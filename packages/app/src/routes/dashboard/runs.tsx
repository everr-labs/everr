import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/runs")({
  staticData: { breadcrumb: "Runs" },
  head: () => ({
    meta: [{ title: "Everr - Runs" }],
  }),
  component: () => <Outlet />,
});
