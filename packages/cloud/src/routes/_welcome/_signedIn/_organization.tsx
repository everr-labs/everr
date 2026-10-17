import { createFileRoute } from "@tanstack/react-router";
import { requireOrganization } from "@everr/app/lib/route-access";

export const Route = createFileRoute("/_welcome/_signedIn/_organization")({
  beforeLoad: requireOrganization,
});
