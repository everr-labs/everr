import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/route-access";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: requireSession,
});
