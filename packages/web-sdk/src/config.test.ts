import { describe, expect, it } from "vitest";
import { resolveTransport } from "./config.js";

describe("resolveTransport", () => {
  it("sends to the hosted ingest with a Bearer header when a key is set", () => {
    expect(resolveTransport({ ingestKey: "pub_abc" })).toEqual([
      "https://ingest.everr.dev/v1/logs",
      "https://ingest.everr.dev/v1/traces",
      { Authorization: "Bearer pub_abc" },
    ]);
  });

  it("prefers an explicit endpoint override, appending the OTLP logs path and keeping the key's header", () => {
    expect(
      resolveTransport({
        ingestKey: "pub_abc",
        endpoint: "https://collector.example/",
      }),
    ).toEqual([
      "https://collector.example/v1/logs",
      "https://collector.example/v1/traces",
      { Authorization: "Bearer pub_abc" },
    ]);
    expect(resolveTransport({ endpoint: "https://collector.example" })).toEqual(
      [
        "https://collector.example/v1/logs",
        "https://collector.example/v1/traces",
        undefined,
      ],
    );
  });

  it("falls back to the local collector in dev with no key", () => {
    expect(resolveTransport({ dev: true })).toEqual([
      "http://127.0.0.1:54318/v1/logs",
      "http://127.0.0.1:54318/v1/traces",
      undefined,
    ]);
  });

  it("resolves to null (structural no-op) for a keyless production build", () => {
    expect(resolveTransport({})).toBeNull();
    expect(resolveTransport({ ingestKey: "   " })).toBeNull();
  });
});
