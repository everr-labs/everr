import {
  ensureOrganizationAdmin,
  NotOrganizationAdminError,
} from "@everr/app/data/organization-admin";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_organization/_dashboard/_padded/_admin")({
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
        <EmptyDescription>You don&apos;t have permission to view this page.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
