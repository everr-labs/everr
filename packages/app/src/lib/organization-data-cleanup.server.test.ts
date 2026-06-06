import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAnd, mockDelete, mockEq, mockTransaction, whereCalls } = vi.hoisted(
  () => ({
    mockAnd: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
    mockDelete: vi.fn(),
    mockEq: vi.fn((column: unknown, value: unknown) => ({
      type: "eq",
      column,
      value,
    })),
    mockTransaction: vi.fn(),
    whereCalls: [] as Array<{ table: unknown; condition: unknown }>,
  }),
);

vi.mock("@/db/client", () => ({
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: mockAnd,
    eq: mockEq,
  };
});

import {
  apikey,
  githubInstallationOrganizations,
  workflowJobs,
  workflowRuns,
} from "@/db/schema";
import { deletePostgresOrganizationData } from "./organization-data-cleanup.server";

const ORG = "org42";

beforeEach(() => {
  vi.clearAllMocks();
  whereCalls.length = 0;
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
