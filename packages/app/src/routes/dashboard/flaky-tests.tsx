import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/flaky-tests")({
  staticData: { breadcrumb: "Flaky Tests" },
  component: () => <Outlet />,
});
