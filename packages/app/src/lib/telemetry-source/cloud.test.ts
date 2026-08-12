import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

vi.mock("@/data/dashboards/server", () => ({
  executePanelSql: vi.fn(),
}));

import { executePanelSql } from "@/data/dashboards/server";
import { createCloudSqlClient } from "./cloud";

const mockedExecute = vi.mocked(executePanelSql);

beforeEach(() => {
  mockedExecute.mockReset();
});

describe("createCloudSqlClient", () => {
  // The point of the seam: for the same call, both clients hand back the same
  // shape, so a repository cannot tell which backend it was given.
  it("returns the rows the server function produced", async () => {
    mockedExecute.mockResolvedValueOnce({ rows: [{ a: 1 }, { a: 2 }] });

    const rows = await createCloudSqlClient().execute("SELECT 1", {});

    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("passes the SQL and bound parameters through unchanged", async () => {
    mockedExecute.mockResolvedValueOnce({ rows: [] });

    await createCloudSqlClient().execute("SELECT {step:UInt32}", {
      from: "2026-08-01 00:00:00.000",
      to: "2026-08-01 01:00:00.000",
      step: 60,
    });

    expect(mockedExecute).toHaveBeenCalledWith({
      data: {
        sql: "SELECT {step:UInt32}",
        params: {
          from: "2026-08-01 00:00:00.000",
          to: "2026-08-01 01:00:00.000",
          step: 60,
        },
      },
    });
  });

  it("returns an empty array for an empty result", async () => {
    mockedExecute.mockResolvedValueOnce({ rows: [] });

    const rows = await createCloudSqlClient().execute("SELECT 1", {});

    expect(rows).toEqual([]);
  });
});
