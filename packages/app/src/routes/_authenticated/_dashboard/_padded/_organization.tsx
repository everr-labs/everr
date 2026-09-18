import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  ensureOrganizationAdmin,
  NotOrganizationAdminError,
} from "@/data/organization-admin";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/_organization",
)({
  beforeLoad: async () => {
    await ensureOrganizationAdmin();
  },
  errorComponent: ({ error }) => {
    if (
      error instanceof NotOrganizationAdminError ||
      (error instanceof Error && error.message === "Not authorized")
    ) {
      return <OrganizationManagementUnauthorized />;
    }
    throw error;
  },
  component: Outlet,
});

function OrganizationManagementUnauthorized() {
  return (
    <Empty className="min-h-full">
      <EmptyHeader>
        <EmptyTitle as="h2">Not authorized</EmptyTitle>
        <EmptyDescription>
          You don't have permission to view this page.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
