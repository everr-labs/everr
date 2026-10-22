import type { ApplicationStorage } from "@everr/app/composition";
import {
  sqlApiOrgPassword,
  sqlApiOrgUserName,
} from "../../clickhouse/credentials";
import { assertOrganizationProvisioned } from "../../organization-provisioning/metadata";

export const storage: ApplicationStorage = {
  appQuerySettings(organizationId, settings) {
    return { ...settings, SQL_everr_tenant_id: organizationId };
  },
  sqlApiAccess(organizationId) {
    const username = sqlApiOrgUserName(organizationId);
    return {
      auth: { username, password: sqlApiOrgPassword(organizationId) },
      http_headers: { "X-ClickHouse-Quota": username },
    };
  },
  assertStorageReady: assertOrganizationProvisioned,
  telemetryTenantId: (organizationId) => organizationId,
};
