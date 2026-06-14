import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { EVERR_ALERTS_TELEGRAM_BOT_TOKEN: "tok" },
}));

import { sendTelegramMessage } from "./telegram.server";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = () => ({ ok: true, status: 200, text: async () => "" });
const err = (status: number, body: string) => ({
  ok: false,
  status,
  text: async () => body,
});

function sentBody(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

describe("sendTelegramMessage", () => {
  it("sends plain text with no parse mode or markup", async () => {
    fetchMock.mockResolvedValueOnce(ok());

    await sendTelegramMessage("123", "🚨 s1 firing");

    const body = sentBody(0);
    expect(body).toEqual({ chat_id: "123", text: "🚨 s1 firing" });
  });

  it("truncates text past telegram's 4096-character limit", async () => {
    fetchMock.mockResolvedValueOnce(ok());

    await sendTelegramMessage("123", "x".repeat(5000));

    const body = sentBody(0);
    expect(body.text).toHaveLength(4096);
    expect(body.text.endsWith("…")).toBe(true);
  });

  it("does not split surrogate pairs when truncating", async () => {
    fetchMock.mockResolvedValueOnce(ok());

    await sendTelegramMessage("123", `${"x".repeat(4094)}😀tail`);

    const body = sentBody(0);
    expect(body.text).toHaveLength(4095);
    expect(body.text).toBe(`${"x".repeat(4094)}…`);
  });

  it("throws with the response details on failure", async () => {
    fetchMock.mockResolvedValueOnce(err(400, "Bad Request: chat not found"));

    await expect(sendTelegramMessage("123", "hi")).rejects.toThrow(
      "telegram sendMessage failed: 400 Bad Request: chat not found",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
