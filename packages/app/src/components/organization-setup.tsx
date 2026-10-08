import { useRouteContext, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { OrganizationProvisioning } from "@/components/organization-provisioning";

export function OrganizationSetup() {
  const { session } = useRouteContext({
    from: "/_welcome/_signedIn/_organization",
  });
  const { returnTo } = useSearch({
    from: "/_welcome/_signedIn/_organization/organization-setup",
  });
  const [startedAt] = useState(() => Date.now());
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return null;
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <OrganizationProvisioning
          organizationId={organizationId}
          startedAt={startedAt}
          returnTo={returnTo}
        />
      </div>
    </main>
  );
}
