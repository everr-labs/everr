import { afterEach, describe, expect, it, vi } from "vitest";
import { setAttributes } from "./attributes.js";
import type { WebSDK } from "./client.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
  UNIQUE_ID,
} from "./test-kit.js";
import type { WebSDKOptions } from "./types.js";

let client: WebSDK | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<WebSDKOptions>): void {
  [client, batches] = startClient(options);
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

async function lastRecord(): Promise<Record<string, unknown>> {
  const all = await records();
  return attrs(all[all.length - 1]);
}

afterEach(async () => {
  setAttributes({
    "everr.tenant.id": null,
    "everr.plan": null,
    "everr.flag.beta": null,
  });
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("setAttributes", () => {
  it("stamps the ambient set on every subsequent record", async () => {
    start();
    // The initial page_view predates the call and stays untouched.
    setAttributes({ "everr.tenant.id": "acme", "everr.flag.beta": true });
    history.pushState(null, "", "/tenant-page");
    const all = await records();
    expect(attrs(all[0])).not.toHaveProperty("everr.tenant.id");
    const a = attrs(all[all.length - 1]);
    expect(a["everr.tenant.id"]).toBe("acme");
    expect(a["everr.flag.beta"]).toBe(true);
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    history.replaceState(null, "", "/");
  });

  it("merges shallowly; a null value clears the key", async () => {
    start();
    setAttributes({ "everr.tenant.id": "acme", "everr.plan": "pro" });
    setAttributes({ "everr.plan": "enterprise" });
    history.pushState(null, "", "/a");
    let a = await lastRecord();
    expect(a["everr.tenant.id"]).toBe("acme");
    expect(a["everr.plan"]).toBe("enterprise");

    setAttributes({ "everr.plan": null });
    history.pushState(null, "", "/b");
    a = await lastRecord();
    expect(a["everr.tenant.id"]).toBe("acme");
    expect(a).not.toHaveProperty("everr.plan");
    history.replaceState(null, "", "/");
  });

  it("loses to per-record attributes on collision", async () => {
    start({
      instrumentations: [
        (ctx) => () => {
          ctx.emit("everr.test.collision", { "everr.tenant.id": "record" });
        },
      ],
    });
    setAttributes({ "everr.tenant.id": "ambient" });
    await client?.shutdown();
    const all = batches.flatMap((b) => b.records);
    const a = attrs(all[all.length - 1]);
    expect(a["everr.tenant.id"]).toBe("record");
    client = undefined;
  });

  it("is memory-only but survives a consent re-init, like the route resolver", async () => {
    start();
    setAttributes({ "everr.tenant.id": "acme" });
    await client?.shutdown();
    start();
    history.pushState(null, "", "/fresh");
    const a = await lastRecord();
    expect(a["everr.tenant.id"]).toBe("acme");
    expect(localStorage.length).toBe(0);
    history.replaceState(null, "", "/");
  });
});
