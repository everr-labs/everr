// @vitest-environment node
//
// The server half of init(): no window, no document. startClient works
// unchanged because init() itself branches on the runtime.
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "./client.js";
import { captureError } from "./errors.js";
import { logger } from "./logger.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
} from "./test-kit.js";
import type { EverrClient } from "./types.js";

let client: EverrClient | undefined;
let batches: OtlpBatch[];

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
});

describe("init (server)", () => {
  it("emits custom logs through the pipeline, without any browser envelope", async () => {
    [client, batches] = startClient();
    logger.info("ssr render done", { "everr.render.ms": 12 });
    const [record] = await records();
    expect(record.eventName).toBe("");
    expect(record.severityNumber).toBe(9);
    expect(record.body).toEqual({ stringValue: "ssr render done" });
    const a = attrs(record);
    expect(a["everr.render.ms"]).toBe("12");
    expect(a).not.toHaveProperty("session.id");
    expect(a).not.toHaveProperty("url.full");
  });

  it("stamps server resource attributes and none of the browser ones", async () => {
    [client, batches] = startClient();
    logger.warn("careful");
    await client.flush();
    const resource = Object.fromEntries(
      batches[0].resource.map(({ key, value }) => [
        key,
        Object.values(value)[0],
      ]),
    );
    expect(resource["service.name"]).toBe("everr-docs-test");
    expect(resource["process.runtime.name"]).toBe("node");
    expect(String(resource["process.runtime.version"])).toMatch(/^\d+\./);
    expect(resource).not.toHaveProperty("user_agent.original");
    expect(resource).not.toHaveProperty("everr.screen.width");
  });

  it("reports captureError with the shared exception wire contract", async () => {
    [client, batches] = startClient();
    captureError(new Error("ssr boom"), { "everr.loader.route": "/x" });
    const [record] = await records();
    expect(record.eventName).toBe("exception");
    expect(record.severityNumber).toBe(17);
    const a = attrs(record);
    expect(a["exception.type"]).toBe("Error");
    expect(a["exception.message"]).toBe("ssr boom");
    expect(String(a["exception.stacktrace"])).toContain("ssr boom");
    expect(a["everr.error.handled"]).toBe(true);
    expect(a["everr.error.mechanism"]).toBe("manual");
    expect(a["everr.loader.route"]).toBe("/x");
  });

  it("goes silent after shutdown and stays a structural no-op without a key", async () => {
    [client, batches] = startClient();
    await client.shutdown();
    logger.info("after shutdown");
    captureError(new Error("after shutdown"));
    await client.flush();
    expect(batches).toHaveLength(0);
    client = undefined;

    // Keyless production init never builds an emitter on the server either.
    const inert = init({ serviceName: "everr-docs-test" });
    await expect(inert.flush()).resolves.toBeUndefined();
  });
});
