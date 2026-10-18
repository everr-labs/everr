import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "#app/lib/route-access.ts";

export const Route = createFileRoute("/_welcome/_signedIn")({
  // Keep guard inference independent of `matches`, which depends on the full router.
  beforeLoad: (options): ReturnType<typeof requireSession> =>
    requireSession(options),
});
