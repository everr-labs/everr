import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { initClient, teardown } from "./core.js";
import { errorTrackingPlugin } from "./fastify.js";
import { setupTestTelemetry } from "./test-utils.js";

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
  initClient({}, "node", []);
});

afterEach(async () => {
  teardown();
  await otel.dispose();
});

describe("errorTrackingPlugin", () => {
  it("captures route errors with http attributes", async () => {
    const app = fastify();
    await app.register(errorTrackingPlugin);
    app.get("/boom", async () => {
      throw new Error("fastify exploded");
    });
    const response = await app.inject({
      method: "GET",
      url: "/boom?token=s3cret&page=2",
    });
    expect(response.statusCode).toBe(500);
    const [record] = otel.records();
    expect(record.eventName).toBe("http.server.request.exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("fastify");
    expect(record.attributes["exception.message"]).toBe("fastify exploded");
    expect(record.attributes["http.request.method"]).toBe("GET");
    expect(record.attributes["url.full"]).toBeUndefined();
    expect(record.attributes["url.path"]).toBe("/boom");
    await app.close();
  });

  it("covers routes registered outside the plugin scope (skip-override)", async () => {
    const app = fastify();
    await app.register(errorTrackingPlugin);
    await app.register(async (scope) => {
      scope.get("/nested", async () => {
        throw new Error("nested boom");
      });
    });
    await app.inject({ method: "GET", url: "/nested" });
    expect(otel.records()).toHaveLength(1);
    await app.close();
  });
});
