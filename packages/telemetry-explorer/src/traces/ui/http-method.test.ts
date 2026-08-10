import { describe, expect, it } from "vitest";
import { isSafeMethod, splitSpanName } from "./http-method";

describe("splitSpanName", () => {
  it("splits a conventional HTTP server span name", () => {
    expect(splitSpanName("GET /api/orders")).toEqual({
      method: "GET",
      label: "/api/orders",
    });
  });

  it("classifies state-changing methods as unsafe", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT"]) {
      expect(isSafeMethod(method)).toBe(false);
    }
  });

  it("classifies read-only methods as safe", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "TRACE"]) {
      expect(isSafeMethod(method)).toBe(true);
    }
  });

  it("leaves a database span alone", () => {
    expect(splitSpanName("SELECT users")).toEqual({
      method: null,
      label: "SELECT users",
    });
  });

  it("leaves a worker span alone", () => {
    expect(splitSpanName("worker.process_payment")).toEqual({
      method: null,
      label: "worker.process_payment",
    });
  });

  it("does not match a lowercase leading word", () => {
    expect(splitSpanName("get /api/orders").method).toBeNull();
  });

  it("keeps an empty label for a bare method", () => {
    expect(splitSpanName("GET")).toEqual({
      method: "GET",
      label: "",
    });
  });

  it("keeps the whole route when it contains spaces", () => {
    expect(splitSpanName("GET /api/orders and more").label).toBe(
      "/api/orders and more",
    );
  });
});
