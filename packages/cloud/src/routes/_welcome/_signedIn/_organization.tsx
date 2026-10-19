import { requireOrganization } from "@everr/app/lib/route-access";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_welcome/_signedIn/_organization")({
  beforeLoad: requireOrganization,
});
