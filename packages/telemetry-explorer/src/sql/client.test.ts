import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { queryRows } from "./client";
import { SqlCountSchema } from "./row-schemas";

const RowSchema = z.object({ count: SqlCountSchema.transform(Number) });

describe("validated SQL query results", () => {
  it("uses schema output types while preserving transport arguments", async () => {
    const execute = vi.fn().mockResolvedValue([{ count: "42", ignored: true }]);
    expect(
      await queryRows({ execute }, RowSchema, "SELECT count() AS count", { limit: 5 }),
    ).toEqual([{ count: 42 }]);
    expect(execute).toHaveBeenCalledWith("SELECT count() AS count", { limit: 5 });
  });

  it.each([null, {}, [null], [{}], [{ count: "NaN" }], [{ count: 1 }, { count: "" }]])(
    "rejects malformed results before returning any partial data: %j",
    async (response) => {
      const execute = vi.fn().mockResolvedValue(response);
      await expect(
        queryRows({ execute }, RowSchema, "SELECT count() AS count", {}),
      ).rejects.toThrow("Invalid SQL query response");
    },
  );

  it("preserves empty results and transport failures", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Query unavailable"));
    expect(await queryRows({ execute }, RowSchema, "SELECT 1", {})).toEqual([]);
    await expect(queryRows({ execute }, RowSchema, "SELECT 1", {})).rejects.toThrow(
      "Query unavailable",
    );
  });
});
