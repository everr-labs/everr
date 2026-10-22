import { pages } from "@composition/pages";
import { createFileRoute } from "@tanstack/react-router";

const members = pages.members;

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/_admin/users-management",
)({
  staticData: { breadcrumb: "Members", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Members" }] }),
  loader: ({ context }) =>
    members.load?.({
      queryClient: context.queryClient,
      organizationId: context.organization.id,
    }),
  component: MembersPage,
});

function MembersPage() {
  const { organization } = Route.useRouteContext();
  return <members.component organizationId={organization.id} />;
}
