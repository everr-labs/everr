import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
} from "@tanstack/react-start/server";
import { z } from "zod";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import { auth } from "@/lib/auth.server";
import {
  ORGANIZATION_CREATION_COOKIE,
  readCreatedOrganizationId,
} from "@/lib/organization-creation-continuation.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";
import { restartOrganizationProvisioningJob } from "@/server/organization-provisioning/jobs";
import { readOrganizationProvisioningStatus } from "@/server/organization-provisioning/status";
import { getActiveOrganizationAccess } from "./organization-access";

export const getOrganizationProvisioningStatus =
  createPartiallyAuthenticatedServerFn({ method: "GET" }).handler(async () => {
    const access = await getActiveOrganizationAccess();
    if (access.status === "missing") return null;
    const { organization } = access;
    return {
      id: organization.id,
      status: await readOrganizationProvisioningStatus(organization),
    };
  });

export const completeOrganizationSetup = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ organizationId: z.string().min(1) }))
  .handler(async ({ data, context: { session } }) => {
    const createdOrganizationId = await readCreatedOrganizationId(
      getCookie(ORGANIZATION_CREATION_COOKIE),
      session.session,
    );
    if (createdOrganizationId === data.organizationId)
      deleteCookie(ORGANIZATION_CREATION_COOKIE, { path: "/" });
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
      if (!isOrganizationProvisioned(organization.metadata))
        await restartOrganizationProvisioningJob(organization.id);
    });
