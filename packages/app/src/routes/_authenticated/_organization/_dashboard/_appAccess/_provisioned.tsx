import { ensureStorageReady } from "@app/storage-readiness";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned",
)({
  staticData: { showDataControls: true },
  beforeLoad: ({ context: { organization }, location }) => {
    ensureStorageReady(organization.metadata, location.href);
  },
});
