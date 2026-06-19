import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSlackMessage } from "./slack.server";

const url = "https://hooks.slack.com/services/T0/B0/abc";
const payload = { attachments: [{ color: "#dc2626", blocks: [] }] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendSlackMessage", () => {
  it("POSTs the payload as JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
    await sendSlackMessage(url, payload);
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("throws on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("invalid_payload", { status: 400 }),
    );
    await expect(sendSlackMessage(url, payload)).rejects.toThrow(/400/);
  });
});
