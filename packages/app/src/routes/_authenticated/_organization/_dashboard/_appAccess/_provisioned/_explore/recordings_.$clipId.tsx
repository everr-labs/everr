import { createFileRoute } from "@tanstack/react-router";
import { useRealtimeSubscription } from "#app/hooks/use-realtime-subscription.ts";
import { RecordingDetail } from "./-recordings/detail";
import { RecordingsSearchSchema } from "./-recordings/search";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/recordings_/$clipId",
)({
  staticData: { breadcrumb: "Detail", hideExploreBar: true },
  validateSearch: RecordingsSearchSchema,
  head: () => ({ meta: [{ title: "Everr - Recording" }] }),
  component: RecordingDetailPage,
});

function RecordingDetailPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const { clipId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <RecordingDetail
      clipId={clipId}
      search={search}
      onBack={() => {
        void navigate({ to: "/recordings", search });
      }}
    />
  );
}
