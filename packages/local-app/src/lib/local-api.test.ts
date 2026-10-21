import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { invokeCommand } from "./local-api";

const ResponseSchema = z.object({ count: z.number().int() }).transform(({ count }) => count);

describe("local command boundary", () => {
  it("returns the schema's output and sends the local command headers and arguments", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"count":42,"extra":true}'));
    vi.stubGlobal("fetch", fetch);
    expect(await invokeCommand("example", ResponseSchema, { enabled: true })).toBe(42);
    expect(fetch).toHaveBeenCalledWith("/api/commands/example", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Everr-Local": "1" },
      body: '{"enabled":true}',
    });
  });

  it.each(["null", "[]", '{"count":"42"}', '{"count":1.5}', "<html>Bad gateway</html>"])(
    "rejects an invalid success response: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      await expect(invokeCommand("example", ResponseSchema)).rejects.toThrow(
        "Invalid local response",
      );
    },
  );

  it("retains a validated server error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"error":"Collector exited"}', { status: 500 })),
    );
    await expect(invokeCommand("example", ResponseSchema)).rejects.toThrow("Collector exited");
  });

  it.each(["null", '{"error":42}', '{"error":""}', "<html>Bad gateway</html>"])(
    "uses a safe fallback for a malformed error response: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 500 })));
      await expect(invokeCommand("example", ResponseSchema)).rejects.toThrow(
        "Local request failed",
      );
    },
  );

  it("preserves network failures", async () => {
    const error = new TypeError("Network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(invokeCommand("example", ResponseSchema)).rejects.toBe(error);
  });
});
