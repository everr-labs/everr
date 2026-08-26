import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAnd,
  mockDelete,
  mockEq,
  mockInArray,
  mockTransaction,
  serviceAccountUserRows,
  whereCalls,
} = vi.hoisted(() => ({
  mockAnd: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  mockDelete: vi.fn(),
  mockEq: vi.fn((column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  })),
  mockInArray: vi.fn((column: unknown, values: unknown) => ({
    type: "inArray",
    column,
    values,
  })),
  mockTransaction: vi.fn(),
  serviceAccountUserRows: [] as Array<{ userId: string }>,
  whereCalls: [] as Array<{ table: unknown; condition: unknown }>,
}));

// The rows the service-account lookup finds. Only its result matters here;
// the chain that produces it is a passthrough.
function makeSelectChain() {
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder passthrough mock has no fixed shape.
  const chain: any = {
    from: () => chain,
    innerJoin: async () => serviceAccountUserRows,
  };
  return chain;
}

vi.mock("@/db/client", () => ({
  db: {
    transaction: mockTransaction,
    select: () => makeSelectChain(),
    delete: (table: unknown) => mockDelete(table),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: mockAnd,
    eq: mockEq,
    inArray: mockInArray,
  };
});

import {
  apikey,
  githubInstallationOrganizations,
  member,
  serviceAccount,
  user,
  workflowJobs,
  workflowRuns,
} from "@/db/schema";
import {
  deleteOrganizationServiceAccounts,
  deletePostgresOrganizationData,
} from "./organization-data-cleanup.server";

const ORG = "org42";

beforeEach(() => {
  vi.clearAllMocks();
  whereCalls.length = 0;
  serviceAccountUserRows.length = 0;
  mockTransaction.mockImplementation(async (callback) =>
    callback({
      delete: mockDelete,
    }),
  );
  mockDelete.mockImplementation((table) => ({
    where: async (condition: unknown) => {
      whereCalls.push({ table, condition });
    },
  }));
});

describe("deletePostgresOrganizationData", () => {
  it("deletes non-cascading organization data in a transaction", async () => {
    await deletePostgresOrganizationData(ORG);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(whereCalls.map((call) => call.table)).toEqual([
      workflowJobs,
      workflowRuns,
      githubInstallationOrganizations,
      apikey,
    ]);
    expect(mockEq).toHaveBeenCalledWith(workflowJobs.organizationId, ORG);
    expect(mockEq).toHaveBeenCalledWith(workflowRuns.organizationId, ORG);
    expect(mockEq).toHaveBeenCalledWith(
      githubInstallationOrganizations.organizationId,
      ORG,
    );
    expect(mockEq).toHaveBeenCalledWith(apikey.configId, "ingest");
    expect(mockEq).toHaveBeenCalledWith(apikey.referenceId, ORG);
    expect(mockAnd).toHaveBeenCalledWith(
      { type: "eq", column: apikey.configId, value: "ingest" },
      { type: "eq", column: apikey.referenceId, value: ORG },
    );
  });
});

describe("deleteOrganizationServiceAccounts", () => {
  it("deletes the machine users the organization's members point at", async () => {
    // Deleting the organization cascades the member rows away but leaves
    // the user rows, so the service accounts have to go first.
    serviceAccountUserRows.push({ userId: "user-1" }, { userId: "user-2" });

    await deleteOrganizationServiceAccounts(ORG);

    expect(whereCalls).toEqual([
      {
        table: user,
        condition: {
          type: "inArray",
          column: user.id,
          values: ["user-1", "user-2"],
        },
      },
    ]);
  });

  it("scopes the lookup to this organization's memberships", async () => {
    serviceAccountUserRows.push({ userId: "user-1" });

    await deleteOrganizationServiceAccounts(ORG);

    expect(mockEq).toHaveBeenCalledWith(member.userId, serviceAccount.userId);
    expect(mockEq).toHaveBeenCalledWith(member.organizationId, ORG);
  });

  it("deletes nothing when the organization holds no service accounts", async () => {
    await deleteOrganizationServiceAccounts(ORG);

    expect(whereCalls).toEqual([]);
  });
});
