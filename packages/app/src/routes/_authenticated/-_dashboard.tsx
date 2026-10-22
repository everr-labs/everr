import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "#app/components/dashboard-layout.tsx";

export const Route = createFileRoute("/_authenticated/_dashboard")({
  component: DashboardLayout,
});
