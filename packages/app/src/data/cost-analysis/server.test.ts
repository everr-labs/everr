import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import {
  getCostByWorkflow,
  getCostOverTimeBreakdown,
  getCostOverview,
} from "./server";

const mockedQuery = vi.mocked(query);
const timeRange = {
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-05-31T23:59:59.999Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue([]);
});

describe("cost analysis queries", () => {
  it("exposes ResourceAttributes key checks for cost overview skip indexes", async () => {
    await getCostOverview({ data: { timeRange } });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.worker.labels')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.task.run.id')",
    );
    expect(sql).not.toContain("PREWHERE");
    expect(sql).not.toContain("SQL_everr_tenant_id");
  });

  it("exposes ResourceAttributes key checks for workflow grouping", async () => {
    await getCostByWorkflow({ data: { timeRange } });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.worker.labels')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.task.run.id')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'vcs.repository.name')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.name')",
    );
  });

  it("exposes ResourceAttributes key checks for over-time breakdown", async () => {
    await getCostOverTimeBreakdown({
      data: { timeRange, dimension: "repo" },
    });

    const sql = mockedQuery.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.worker.labels')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'cicd.pipeline.task.run.id')",
    );
    expect(sql).toContain(
      "mapContains(ResourceAttributes, 'vcs.repository.name')",
    );
  });
});
