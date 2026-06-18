import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import { createFileRoute } from "@tanstack/react-router";
import { useRealtimeSubscription } from "@/hooks/use-realtime-subscription";
import { ErrorDetailRouteContent } from "./-error-detail";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_explore/errors_/$fingerprint",
)({
  staticData: { breadcrumb: "Detail", fullBleed: true, hideExploreBar: true },
  head: () => ({ meta: [{ title: "Everr - Error detail" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorDetailPage,
});

function ErrorDetailPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const { fingerprint } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <ErrorDetailRouteContent
      fingerprint={fingerprint}
      search={search}
      detailTo="/errors/$fingerprint"
      onBack={() =>
        navigate({
          to: "/errors",
          search: { ...search, occurrence: "" },
        })
      }
    />
  );
}
