import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "@/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";
import { restartOrganizationProvisioningJob } from "@/server/organization-provisioning/jobs";
import { readOrganizationProvisioningStatus } from "@/server/organization-provisioning/status";
import { getActiveOrganization } from "./auth";

export const getOrganizationProvisioningStatus =
  createPartiallyAuthenticatedServerFn({ method: "GET" }).handler(async () => {
    const organization = await getActiveOrganization();
    if (!organization) return null;
    return {
      id: organization.id,
      status: await readOrganizationProvisioningStatus(organization),
    };
  });

export const retryOrganizationProvisioning =
  createPartiallyAuthenticatedServerFn({ method: "POST" })
    .inputValidator(z.object({ organizationId: z.string().min(1) }))
    .handler(async ({ data: { organizationId } }) => {
      // Explicitly verify membership in the requested organization, including
      // when the session's active organization changed after rendering the page.
      const organization = await auth.api.getFullOrganization({
        headers: getRequestHeaders(),
        query: { organizationId },
      });
      if (!organization) throw new Error("Organization not found");
      if ((await readOrganizationProvisioningStatus(organization)) === "failed")
        await restartOrganizationProvisioningJob(organization.id);
    });
