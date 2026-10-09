import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/dashboard-layout";

export const Route = createFileRoute("/_authenticated/_dashboard")({
  component: DashboardLayout,
});
