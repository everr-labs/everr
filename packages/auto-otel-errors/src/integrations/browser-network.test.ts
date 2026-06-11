// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { browserNetworkIntegration } from "./browser-network.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof browserNetworkIntegration>;
let client: Client;
let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
  otel = setupTestTelemetry();
  fetchStub = vi.fn(async () => ({ status: 200 }) as Response);
  (globalThis as { fetch?: unknown }).fetch = fetchStub;
  client = new Client({}, "browser", []);
  integration = browserNetworkIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  await otel.dispose();
});

describe("browserNetworkIntegration / fetch", () => {
  it("captures 5xx responses", async () => {
    fetchStub.mockResolvedValueOnce({ status: 503 } as Response);
    await fetch("https://api.example.com/data", { method: "POST" });
    const [record] = otel.records();
    expect(record.attributes["exception.mechanism"]).toBe("fetch");
    expect(record.attributes["http.request.method"]).toBe("POST");
    expect(record.attributes["http.response.status_code"]).toBe(503);
  });

  it("records breadcrumbs for successful requests without capturing", async () => {
    await fetch("https://api.example.com/ok");
    expect(otel.records()).toHaveLength(0);
    expect(client.breadcrumbs?.all()[0]).toMatchObject({
      category: "http",
      message: "GET https://api.example.com/ok 200",
    });
  });

  it("captures network failures and rethrows", async () => {
    fetchStub.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetch("https://down.example.com/")).rejects.toThrow(
      "Failed to fetch",
    );
    const [record] = otel.records();
    expect(record.attributes["exception.type"]).toBe("TypeError");
  });

  it("teardown restores the original fetch", () => {
    integration.teardown?.();
    expect(globalThis.fetch).toBe(fetchStub);
  });
});

describe("browserNetworkIntegration / XHR", () => {
  it("captures requests that end with status 0 as network failures", async () => {
    const xhr = new XMLHttpRequest();
    const done = new Promise<void>((resolve) =>
      xhr.addEventListener("loadend", () => resolve()),
    );
    xhr.open("GET", "http://127.0.0.1:1/unreachable");
    xhr.send();
    await done;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const records = otel.records();
    expect(records).toHaveLength(1);
    expect(records[0].attributes["exception.mechanism"]).toBe("xhr");
  });
});
