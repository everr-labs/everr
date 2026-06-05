import { ErrorIssueSearchSchema } from "@everr/telemetry-explorer/errors";
import { createFileRoute } from "@tanstack/react-router";
import { DetailRouteDialog } from "@/components/detail-route-dialog";
import { ErrorDetailRouteContent } from "../../-error-detail";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/errors/$fingerprint/modal",
)({
  staticData: { breadcrumb: "Detail", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Error detail" }] }),
  validateSearch: ErrorIssueSearchSchema,
  component: ErrorDetailModalPage,
});

function ErrorDetailModalPage() {
  const { fingerprint } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const close = () =>
    navigate({
      to: "/errors",
      search: { ...search, occurrence: "" },
    });

  return (
    <DetailRouteDialog title="Error detail" onClose={close}>
      <ErrorDetailRouteContent
        fingerprint={fingerprint}
        search={search}
        detailTo="/errors/$fingerprint/modal"
        onBack={close}
      />
    </DetailRouteDialog>
  );
}
