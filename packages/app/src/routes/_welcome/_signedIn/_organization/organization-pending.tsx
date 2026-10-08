import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { returnToSchema } from "@/common/return-to";
import { OrganizationProvisioning } from "@/components/organization-provisioning";

export const Route = createFileRoute(
  "/_welcome/_signedIn/_organization/organization-pending",
)({
  validateSearch: z.object({ returnTo: returnToSchema.default("/") }),
  head: () => ({ meta: [{ title: "Everr - Organization setup" }] }),
  component: OrganizationPending,
});

function OrganizationPending() {
  const { organization } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <OrganizationProvisioning
          organizationId={organization.id}
          startedAt={0}
          returnTo={returnTo}
          minimumDurationMs={0}
        />
      </div>
    </main>
  );
}
