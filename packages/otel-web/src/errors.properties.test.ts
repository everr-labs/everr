import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSDK } from "./client.js";
import { captureError } from "./index.js";
import { attrs, type OtlpBatch, startClient } from "./test-kit.js";

// Property tests for the error reporter. JavaScript can throw many types of
// value. For each of them, the report must not throw an error, it must always
// make the structure for the network, and it must not be more than the rate
// limit. All these tests use the public captureError function.

let client: WebSDK | undefined;
let batches: OtlpBatch[];

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
});

// Each run and each replay uses a different tag. Thus the rate-limit window at
// module level from one run has no effect on the next run.
let tag = 0;

describe("error normalization", () => {
  it("never throws and always emits the string-typed wire shape", async () => {
    [client, batches] = startClient();
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        expect(() => captureError(thrown)).not.toThrow();
      }),
      { numRuns: 100 },
    );
    await client.flush();
    for (const record of batches.flatMap((b) => b.records)) {
      if (record.eventName !== "exception") continue;
      const a = attrs(record);
      expect(typeof a["exception.type"]).toBe("string");
      expect(typeof a["exception.message"]).toBe("string");
      expect(a["everr.error.mechanism"]).toBe("manual");
      expect(record.severityNumber).toBe(17);
    }
  });

  it("survives arbitrary stack strings, keeping type and message intact", async () => {
    [client, batches] = startClient();
    fc.assert(
      fc.property(fc.string(), (stack) => {
        const error = new Error(`stack-probe-${tag++}`);
        error.stack = stack;
        expect(() => captureError(error)).not.toThrow();
      }),
      { numRuns: 100 },
    );
    await client.flush();
    const probes = batches
      .flatMap((b) => b.records)
      .filter((r) =>
        String(attrs(r)["exception.message"] ?? "").startsWith("stack-probe-"),
      );
    expect(probes.length).toBeGreaterThan(0);
    for (const record of probes) {
      expect(attrs(record)["exception.type"]).toBe("Error");
    }
  });

  it("passes at most five identical errors per window, however many are thrown", async () => {
    [client, batches] = startClient();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), (n) => {
        const message = `burst-${tag++}`;
        for (let i = 0; i < n; i++) captureError(new Error(message));
      }),
      { numRuns: 25 },
    );
    await client.flush();
    const byMessage = new Map<string, number>();
    for (const record of batches.flatMap((b) => b.records)) {
      const message = String(attrs(record)["exception.message"] ?? "");
      if (!message.startsWith("burst-")) continue;
      byMessage.set(message, (byMessage.get(message) ?? 0) + 1);
    }
    expect(byMessage.size).toBeGreaterThan(0);
    for (const count of byMessage.values()) {
      expect(count).toBeLessThanOrEqual(5);
    }
  });
});
