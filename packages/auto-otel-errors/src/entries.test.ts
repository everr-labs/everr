import { afterEach, describe, expect, it } from "vitest";
import * as browserEntry from "./browser.js";
import * as nodeEntry from "./node.js";

afterEach(() => {
  nodeEntry.teardown();
});

describe("entry points", () => {
  it("node entry exposes the public API and default integrations", () => {
    expect(nodeEntry.init).toBeTypeOf("function");
    expect(nodeEntry.captureError).toBeTypeOf("function");
    expect(nodeEntry.teardown).toBeTypeOf("function");
    expect(
      nodeEntry.nodeDefaultIntegrations().map((integration) => integration.name),
    ).toEqual(["nodeGlobalHandlers"]);
  });

  it("browser entry exposes browser default integrations", () => {
    expect(
      browserEntry
        .browserDefaultIntegrations()
        .map((integration) => integration.name),
    ).toEqual(["browserGlobalHandlers", "browserApiErrors"]);
  });

  it("node init installs and teardown uninstalls cleanly", () => {
    const client = nodeEntry.init({ onFatal: "continue" });
    expect(client.runtime).toBe("node");
    expect(() => nodeEntry.teardown()).not.toThrow();
  });
});
