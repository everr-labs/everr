// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { browserDomIntegration } from "./browser-dom.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof browserDomIntegration>;
let client: Client;

beforeEach(() => {
  otel = setupTestTelemetry();
  client = new Client({}, "browser", []);
  integration = browserDomIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  document.body.innerHTML = "";
  await otel.dispose();
});

describe("browserDomIntegration", () => {
  it("records click breadcrumbs with a selector path", () => {
    document.body.innerHTML =
      '<div class="page"><button id="save" class="btn primary">Save</button></div>';
    document
      .querySelector("#save")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const crumb = client.breadcrumbs?.all().at(-1);
    expect(crumb?.category).toBe("ui.click");
    expect(crumb?.message).toBe("button#save");
  });

  it("records navigation breadcrumbs for pushState", () => {
    history.pushState({}, "", "/settings");
    const crumb = client.breadcrumbs?.all().at(-1);
    expect(crumb?.category).toBe("navigation");
    expect(crumb?.message).toContain("/settings");
  });

  it("is inert when dom breadcrumbs are disabled", () => {
    integration.teardown?.();
    client = new Client({ breadcrumbs: { dom: false } }, "browser", []);
    integration = browserDomIntegration();
    integration.setup(client);
    document.body.innerHTML = "<button>x</button>";
    document
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(client.breadcrumbs?.all()).toHaveLength(0);
  });

  it("teardown restores history methods and removes listeners", () => {
    const patchedPushState = history.pushState;
    integration.teardown?.();
    expect(history.pushState).not.toBe(patchedPushState);
    history.pushState({}, "", "/after");
    expect(
      client.breadcrumbs?.all().every((c) => !c.message.includes("/after")),
    ).toBe(true);
  });
});
