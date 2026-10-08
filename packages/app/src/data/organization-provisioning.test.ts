import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}));
vi.mock("@/server/organization-provisioning/status", () => ({
  readOrganizationProvisioningStatus: mocks.read,
}));
vi.mock("@/server/organization-provisioning/jobs", () => ({
  restartOrganizationProvisioningJob: mocks.retry,
}));

import { auth } from "@/lib/auth.server";
import { retryOrganizationProvisioning } from "./organization-provisioning";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
    id: "requested-org",
    metadata: { clickhouseReady: false },
  } as never);
  mocks.read.mockResolvedValue("failed");
});
it("verifies membership in the requested organization before restarting its failed job", async () => {
  await retryOrganizationProvisioning({
    data: { organizationId: "requested-org" },
  });
  expect(auth.api.getFullOrganization).toHaveBeenCalledWith({
    headers: new Headers(),
    query: { organizationId: "requested-org" },
  });
  expect(mocks.retry).toHaveBeenCalledWith("requested-org");
});
it("does not retry when organization membership has been revoked", async () => {
  vi.mocked(auth.api.getFullOrganization).mockRejectedValue(
    new Error("Not a member"),
  );
  await expect(
    retryOrganizationProvisioning({
      data: { organizationId: "requested-org" },
    }),
  ).rejects.toThrow("Not a member");
  expect(mocks.retry).not.toHaveBeenCalled();
});
it("does not restart an already-ready organization", async () => {
  vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
    id: "requested-org",
    metadata: { clickhouseReady: true },
  } as never);
  await retryOrganizationProvisioning({
    data: { organizationId: "requested-org" },
  });
  expect(mocks.retry).not.toHaveBeenCalled();
});
it("delegates retry eligibility to the atomic restart without another status read", async () => {
  await retryOrganizationProvisioning({
    data: { organizationId: "requested-org" },
  });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.retry).toHaveBeenCalledWith("requested-org");
});
