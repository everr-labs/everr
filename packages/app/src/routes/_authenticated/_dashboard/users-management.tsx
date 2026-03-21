import { createFileRoute } from "@tanstack/react-router";
import { useAccessToken } from "@workos/authkit-tanstack-react-start/client";
import { UsersManagement } from "@workos-inc/widgets";
import { OrgMainBranches } from "./-org-main-branches";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/users-management",
)({
  staticData: { breadcrumb: "Users Management", hideTimeRangePicker: true },
  head: () => ({
    meta: [{ title: "Everr - Users Management" }],
  }),
  component: UsersManagementPage,
});

function UsersManagementPage() {
  const { accessToken } = useAccessToken();

  if (!accessToken) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Users Management</h1>
        <p className="text-muted-foreground">
          Manage organization members, invitations, and access.
        </p>
      </div>

      <UsersManagement authToken={accessToken} />

      <OrgMainBranches />
    </div>
  );
}
