import { DetailRouteDialog } from "@everr/telemetry-explorer/errors";
import { createFileRoute } from "@tanstack/react-router";
import { RecordingDetail } from "../../-recordings/detail";
import { RecordingsSearchSchema } from "../../-recordings/search";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/recordings/$clipId/modal",
)({
  staticData: { breadcrumb: "Detail" },
  validateSearch: RecordingsSearchSchema,
  head: () => ({ meta: [{ title: "Everr - Recording" }] }),
  component: RecordingDetailModalPage,
});

function RecordingDetailModalPage() {
  const { clipId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const close = () =>
    navigate({
      to: "/recordings",
      search,
    });

  return (
    <DetailRouteDialog title="Recording" onClose={close}>
      <RecordingDetail
        clipId={clipId}
        search={search}
        onBack={() => {
          void close();
        }}
      />
    </DetailRouteDialog>
  );
}
