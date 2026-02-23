import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertOnConflictDoNothing = vi.fn(() => ({
    returning: insertReturning,
  }));
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: insertOnConflictDoNothing,
  }));
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({
    limit: selectLimit,
  }));
  const selectFrom = vi.fn(() => ({
    where: selectWhere,
  }));
  const select = vi.fn(() => ({
    from: selectFrom,
  }));

  const delWhere = vi.fn();
  const del = vi.fn(() => ({
    where: delWhere,
  }));

  return {
    insert,
    select,
    del,
    insertReturning,
    selectLimit,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq_clause"),
}));

vi.mock("@/db/schema", () => ({
  tenants: {
    id: "tenants.id",
    externalId: "tenants.external_id",
  },
  githubInstallationTenants: {
    githubInstallationId: "github_installation_tenants.github_installation_id",
    tenantId: "github_installation_tenants.tenant_id",
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mocked.insert,
    select: mocked.select,
    delete: mocked.del,
  },
}));

import {
  GithubInstallationAlreadyLinkedError,
  getTenantForOrganizationId,
  linkGithubInstallationToTenant,
} from "./tenants";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkGithubInstallationToTenant", () => {
  it("inserts mapping when installation is not yet linked", async () => {
    mocked.insertReturning.mockResolvedValue([{ githubInstallationId: 42 }]);

    await expect(
      linkGithubInstallationToTenant(42, 7),
    ).resolves.toBeUndefined();

    expect(mocked.select).not.toHaveBeenCalled();
  });

  it("is idempotent when already linked to the same tenant", async () => {
    mocked.insertReturning.mockResolvedValue([]);
    mocked.selectLimit.mockResolvedValue([{ tenantId: 7 }]);

    await expect(
      linkGithubInstallationToTenant(42, 7),
    ).resolves.toBeUndefined();

    expect(mocked.select).toHaveBeenCalledTimes(1);
  });

  it("throws conflict error when already linked to another tenant", async () => {
    mocked.insertReturning.mockResolvedValue([]);
    mocked.selectLimit.mockResolvedValue([{ tenantId: 9 }]);

    await expect(linkGithubInstallationToTenant(42, 7)).rejects.toBeInstanceOf(
      GithubInstallationAlreadyLinkedError,
    );
  });
});

describe("getTenantForOrganizationId", () => {
  it("returns tenant id when mapping exists", async () => {
    mocked.selectLimit.mockResolvedValue([{ id: 12 }]);

    await expect(getTenantForOrganizationId("org_123")).resolves.toBe(12);
  });

  it("returns null when mapping does not exist", async () => {
    mocked.selectLimit.mockResolvedValue([]);

    await expect(getTenantForOrganizationId("org_missing")).resolves.toBeNull();
  });
});
