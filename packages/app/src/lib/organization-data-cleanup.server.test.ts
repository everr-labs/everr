import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAnd,
  mockDelete,
  mockInArray,
  mockEq,
  mockTransaction,
  whereCalls,
} = vi.hoisted(() => ({
  mockAnd: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  mockDelete: vi.fn(),
  mockInArray: vi.fn((column: unknown, value: unknown) => ({
    type: "inArray",
    column,
    value,
  })),
  mockEq: vi.fn((column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  })),
  mockTransaction: vi.fn(),
  whereCalls: [] as Array<{ table: unknown; condition: unknown }>,
}));

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
    inArray: mockInArray,
  };
});

import {
  alertChannels,
  alertDefaultChannels,
  alertDefinitions,
  alertDeliveries,
  alertEvents,
  alertInstances,
  alertNotificationGroups,
  alertSilences,
  apikey,
  dashboards,
  githubInstallationOrganizations,
  previews,
  runbooks,
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
      alertDeliveries,
      alertNotificationGroups,
      alertDefaultChannels,
      alertChannels,
      alertSilences,
      alertEvents,
      alertInstances,
      alertDefinitions,
      dashboards,
      runbooks,
      previews,
      workflowJobs,
      workflowRuns,
      githubInstallationOrganizations,
      apikey,
    ]);
    for (const table of [
      alertDeliveries,
      alertNotificationGroups,
      alertDefaultChannels,
      alertChannels,
      alertSilences,
      alertEvents,
      alertInstances,
      alertDefinitions,
    ]) {
      expect(mockEq).toHaveBeenCalledWith(table.organizationId, ORG);
    }
    expect(mockEq).toHaveBeenCalledWith(workflowJobs.organizationId, ORG);
    expect(mockEq).toHaveBeenCalledWith(workflowRuns.organizationId, ORG);
    expect(mockEq).toHaveBeenCalledWith(
      githubInstallationOrganizations.organizationId,
      ORG,
    );
    expect(mockInArray).toHaveBeenCalledWith(apikey.configId, [
      "public",
      "secret",
      "ingest",
    ]);
    expect(mockEq).toHaveBeenCalledWith(apikey.referenceId, ORG);
    expect(mockAnd).toHaveBeenCalledWith(
      {
        type: "inArray",
        column: apikey.configId,
        value: ["public", "secret", "ingest"],
      },
      { type: "eq", column: apikey.referenceId, value: ORG },
    );
  });
});
