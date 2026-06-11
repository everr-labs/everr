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
    expect(nodeEntry.addBreadcrumb).toBeTypeOf("function");
    expect(nodeEntry.teardown).toBeTypeOf("function");
    expect(
      nodeEntry.nodeDefaultIntegrations().map((integration) => integration.name),
    ).toEqual(["nodeGlobalHandlers", "console", "nodeNetwork"]);
  });

  it("browser entry exposes browser default integrations", () => {
    expect(
      browserEntry
        .browserDefaultIntegrations()
        .map((integration) => integration.name),
    ).toEqual(["browserGlobalHandlers", "console", "browserNetwork", "browserDom"]);
  });

  it("node init installs and teardown uninstalls cleanly", () => {
    const originalError = console.error;
    const client = nodeEntry.init({ onFatal: "continue" });
    expect(client.runtime).toBe("node");
    expect(console.error).not.toBe(originalError);
    nodeEntry.teardown();
    expect(console.error).toBe(originalError);
  });
});
