import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockProvisionSqlApiOrgRole, mockSelect } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return {
    mockFrom,
    mockProvisionSqlApiOrgRole: vi.fn(),
    mockSelect: vi.fn(() => ({ from: mockFrom })),
  };
});

vi.mock("@/db/client", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/lib/clickhouse", () => ({
  provisionSqlApiOrgRole: mockProvisionSqlApiOrgRole,
}));

import { provisionSqlApiOrgRolesForExistingOrganizations } from "./sql-api-org-role-backfill";

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockResolvedValue([]);
  mockProvisionSqlApiOrgRole.mockResolvedValue(undefined);
});

describe("provisionSqlApiOrgRolesForExistingOrganizations", () => {
  it("provisions a SQL API role for each existing organization", async () => {
    mockFrom.mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]);

    await provisionSqlApiOrgRolesForExistingOrganizations();

    expect(mockProvisionSqlApiOrgRole).toHaveBeenCalledTimes(2);
    expect(mockProvisionSqlApiOrgRole).toHaveBeenNthCalledWith(1, "org-1");
    expect(mockProvisionSqlApiOrgRole).toHaveBeenNthCalledWith(2, "org-2");
  });

  it("does not call the provisioner when there are no organizations", async () => {
    await provisionSqlApiOrgRolesForExistingOrganizations();

    expect(mockProvisionSqlApiOrgRole).not.toHaveBeenCalled();
  });
});
