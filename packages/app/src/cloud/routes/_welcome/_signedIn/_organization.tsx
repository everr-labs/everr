import { createFileRoute } from "@tanstack/react-router";
import { requireOrganization } from "@/lib/route-access";

export const Route = createFileRoute("/_welcome/_signedIn/_organization")({
  beforeLoad: requireOrganization,
});
