// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deprovision: vi.fn(),
  error: vi.fn(),
  limit: vi.fn(),
  markReady: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.limit,
        }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  organization: { id: "id" },
}));

vi.mock("@/lib/clickhouse", () => ({
  deprovisionSqlApiOrgUser: mocks.deprovision,
  provisionSqlApiOrgUser: mocks.provision,
}));

vi.mock("@/telemetry/logger", () => ({
  serverLogger: { error: mocks.error },
}));

vi.mock("./status", () => ({
  markSqlApiOrgUserReady: mocks.markReady,
  SQL_API_PROVISION_TASK: "sql-api/provision-org-user",
}));

const ORG = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provision.mockResolvedValue(undefined);
  mocks.deprovision.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue([{ id: ORG }]);
});

describe("runSqlApiOrgUserProvision", () => {
  it("provisions an organization that still exists", async () => {
    const { runSqlApiOrgUserProvision } = await import("./task");

    await runSqlApiOrgUserProvision({ organizationId: ORG });

    expect(mocks.provision).toHaveBeenCalledWith(ORG);
    expect(mocks.markReady).toHaveBeenCalledWith(ORG);
    expect(mocks.deprovision).not.toHaveBeenCalled();
  });

  it("drops the job when the organization is already gone", async () => {
    mocks.limit.mockResolvedValue([]);
    const { runSqlApiOrgUserProvision } = await import("./task");

    await runSqlApiOrgUserProvision({ organizationId: ORG });

    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("removes the ClickHouse user if the organization is deleted mid-provision", async () => {
    mocks.limit.mockResolvedValueOnce([{ id: ORG }]).mockResolvedValueOnce([]);
    const { runSqlApiOrgUserProvision } = await import("./task");

    await runSqlApiOrgUserProvision({ organizationId: ORG });

    expect(mocks.provision).toHaveBeenCalledWith(ORG);
    expect(mocks.deprovision).toHaveBeenCalledWith(ORG);
    expect(mocks.markReady).not.toHaveBeenCalled();
  });

  it("throws a provision failure so Graphile retries", async () => {
    mocks.provision.mockRejectedValue(new Error("Timeout error"));
    const { runSqlApiOrgUserProvision } = await import("./task");

    await expect(
      runSqlApiOrgUserProvision({ organizationId: ORG }),
    ).rejects.toThrow("Timeout error");
    expect(mocks.markReady).not.toHaveBeenCalled();
  });

  it("does not retry a payload that can never succeed", async () => {
    const { runSqlApiOrgUserProvision } = await import("./task");

    await expect(runSqlApiOrgUserProvision({})).resolves.toBeUndefined();

    expect(mocks.error).toHaveBeenCalledWith(
      "sql_api.org_user.provision.invalid_payload",
      expect.objectContaining({
        "exception.message": expect.any(String),
      }),
    );
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});
