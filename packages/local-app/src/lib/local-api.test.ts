import { describe, expect, it, vi } from "vite-plus/test";
import { invokeCommand } from "./local-api";

describe("local command response compatibility", () => {
  it("returns successful responses intact without validating or stripping their fields", async () => {
    const result = { status: "legacy", extra: { count: "2" }, rows: [null, 42] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => result }));

    expect(await invokeCommand("example")).toBe(result);
  });

  it.each([null, false, 42, "legacy"])("preserves successful JSON values: %j", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => result }));
    expect(await invokeCommand("example")).toBe(result);
  });

  it.each([
    ["", ""],
    [42, "42"],
    [false, "false"],
    [{ detail: "legacy" }, "[object Object]"],
    [null, "Local request failed"],
  ])("preserves the original error-message coercion for %j", async (error, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error }) }));
    const failure = await invokeCommand("example").catch((reason: unknown) => reason);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(message);
  });

  it("preserves JSON parsing errors instead of replacing them", async () => {
    const error = new SyntaxError("Invalid JSON");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(error) }),
    );
    await expect(invokeCommand("example")).rejects.toBe(error);
  });

  it("preserves the failure for a null error response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => null }));
    await expect(invokeCommand("example")).rejects.toBeInstanceOf(TypeError);
  });
});
