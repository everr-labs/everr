import { createFileRoute, redirect } from "@tanstack/react-router";

// `Ingest Keys` was renamed to `API keys`. Keep the old path working for
// bookmarks and links by redirecting to the new route.
export const Route = createFileRoute("/_authenticated/_dashboard/ingest-keys")({
  beforeLoad: () => {
    throw redirect({ to: "/api-keys" });
  },
});
