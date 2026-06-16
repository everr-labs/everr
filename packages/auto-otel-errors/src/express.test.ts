import type { Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initClient, teardown } from "./core.js";
import { errorHandler } from "./express.js";
import { setupTestTelemetry } from "./test-utils.js";

let otel: ReturnType<typeof setupTestTelemetry>;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  otel = setupTestTelemetry();
  initClient({}, "node", []);
  const app = express();
  app.get("/boom", () => {
    throw new Error("route exploded");
  });
  app.use(errorHandler());
  app.use(
    (
      _err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ ok: false });
    },
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  teardown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await otel.dispose();
});

describe("errorHandler", () => {
  it("captures the error with http attributes and forwards it", async () => {
    const response = await fetch(`${baseUrl}/boom?token=s3cret&page=2#ignored`);
    expect(response.status).toBe(500);
    const [record] = otel.records();
    expect(record.eventName).toBe("http.server.request.exception");
    expect(record.attributes["everr.error.mechanism"]).toBe("express");
    expect(record.attributes["exception.message"]).toBe("route exploded");
    expect(record.attributes["http.request.method"]).toBe("GET");
    expect(record.attributes["url.full"]).toBe(`${baseUrl}/boom`);
    expect(record.attributes["http.route"]).toBe("/boom");
  });
});
