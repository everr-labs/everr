import { createServer, type Server } from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Client } from "../client.js";
import { setupTestTelemetry } from "../test-utils.js";
import { nodeNetworkIntegration } from "./node-network.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let integration: ReturnType<typeof nodeNetworkIntegration>;
let client: Client;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.includes("drop")) {
      req.socket.destroy();
      return;
    }
    res.statusCode = req.url?.includes("fail") ? 503 : 200;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  otel = setupTestTelemetry();
  client = new Client({}, "node", []);
  integration = nodeNetworkIntegration();
  integration.setup(client);
});

afterEach(async () => {
  integration.teardown?.();
  await otel.dispose();
});

describe("nodeNetworkIntegration", () => {
  it("captures 5xx responses with http attributes and records a breadcrumb", async () => {
    await fetch(`${baseUrl}/fail`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [record] = otel.records();
    expect(record.attributes["exception.mechanism"]).toBe("fetch");
    expect(record.attributes["http.response.status_code"]).toBe(503);
    expect(record.attributes["url.full"]).toContain("/fail");
    expect(client.breadcrumbs?.all().some((c) => c.category === "http")).toBe(
      true,
    );
  });

  it("does not capture 2xx but still records a breadcrumb", async () => {
    await fetch(`${baseUrl}/ok`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otel.records()).toHaveLength(0);
    expect(client.breadcrumbs?.all().length).toBeGreaterThan(0);
  });

  it("captures network failures", async () => {
    await expect(fetch(`${baseUrl}/drop`)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const records = otel.records();
    expect(records).toHaveLength(1);
    expect(records[0].attributes["exception.mechanism"]).toBe("fetch");
  });

  it("honors ignoreUrls", async () => {
    integration.teardown?.();
    client = new Client({ network: { ignoreUrls: [/fail/] } }, "node", []);
    integration = nodeNetworkIntegration();
    integration.setup(client);
    await fetch(`${baseUrl}/fail`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otel.records()).toHaveLength(0);
  });

  it("teardown unsubscribes", async () => {
    integration.teardown?.();
    await fetch(`${baseUrl}/fail`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otel.records()).toHaveLength(0);
  });
});
