import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dashboard/runs")({
  staticData: { breadcrumb: "Runs" },
  head: () => ({
    meta: [{ title: "Everr - Runs" }],
  }),
  component: () => <Outlet />,
});
