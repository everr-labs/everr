import { describe, expect, it, vi } from "vite-plus/test";
import { captureLocalSqlError } from "@/lib/internal-telemetry";
import { localSqlClient } from "./local-sql-client";

vi.mock("@/lib/internal-telemetry", () => ({ captureLocalSqlError: vi.fn() }));

describe("local SQL response validation", () => {
  it("preserves nested JSON column values", async () => {
    const rows = [{ count: 42, large: "9007199254740993", data: { array: [true, null, "safe"] } }];
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(rows)));
    vi.stubGlobal("fetch", fetch);
    expect(await localSqlClient.execute("SELECT :count", { count: 42 })).toEqual(rows);
    expect(fetch).toHaveBeenCalledWith(
      "/api/commands/telemetry_sql_query",
      expect.objectContaining({
        body: JSON.stringify({ sql: "SELECT :count", params: { count: 42 } }),
      }),
    );
  });

  it.each([null, {}, [null], [42], [[]]])("rejects malformed SQL rows: %j", async (rows) => {
    vi.mocked(captureLocalSqlError).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(rows))));
    await expect(localSqlClient.execute("SELECT 1", {})).rejects.toThrow("Invalid local response");
    expect(captureLocalSqlError).toHaveBeenCalledOnce();
  });
});
