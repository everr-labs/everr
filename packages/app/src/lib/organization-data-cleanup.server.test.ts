import type * as DrizzleOrm from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockDelete, mockEq, mockTransaction, whereCalls } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockEq: vi.fn((column: unknown, value: unknown) => ({
    type: "eq",
    column,
    value,
  })),
  mockTransaction: vi.fn(),
  whereCalls: [] as Array<{ table: unknown; condition: unknown }>,
}));

vi.mock("#app/db/client.ts", () => ({
  runInTransaction: (executor: { transaction: typeof mockTransaction }, run: unknown) =>
    executor.transaction(run),
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof DrizzleOrm>();
  return {
    ...actual,
    eq: mockEq,
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
} from "#app/db/schema/index.ts";
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
    expect(mockEq).toHaveBeenCalledWith(githubInstallationOrganizations.organizationId, ORG);
    // Every key config, not just the hashed one: public keys too.
    expect(whereCalls).toContainEqual({
      table: apikey,
      condition: { type: "eq", column: apikey.referenceId, value: ORG },
    });
  });
});
