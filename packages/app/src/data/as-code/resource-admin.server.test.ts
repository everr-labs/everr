// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  adoptResource,
  deleteResource,
  isResourceKind,
  RESOURCE_KINDS,
  ReservedProjectError,
} from "./resource-admin.server";

vi.mock("@/db/client", () => ({
  db: { select: vi.fn(), delete: vi.fn(), update: vi.fn() },
}));

describe("isResourceKind", () => {
  it("accepts the three kinds", () => {
    expect(isResourceKind("dashboard")).toBe(true);
    expect(isResourceKind("runbook")).toBe(true);
    expect(isResourceKind("alert")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isResourceKind("Dashboard")).toBe(false);
    expect(isResourceKind("alertrule")).toBe(false);
    expect(isResourceKind("")).toBe(false);
  });

  it("RESOURCE_KINDS lists exactly the three kinds", () => {
    expect([...RESOURCE_KINDS]).toEqual(["dashboard", "runbook", "alert"]);
  });
});

describe("reserved built-in project", () => {
  // The guard lives in the admin layer so every write verb — present and
  // future — inherits it (ADR 0004). Throwing before any db access is the
  // contract these tests pin.
  it("deleteResource rejects it before touching the database", async () => {
    await expect(
      deleteResource("org-1", "dashboard", "built-in", "log-overview"),
    ).rejects.toBeInstanceOf(ReservedProjectError);
  });

  it("adoptResource rejects it before touching the database", async () => {
    await expect(
      adoptResource("org-1", "dashboard", "built-in", "log-overview", "r"),
    ).rejects.toBeInstanceOf(ReservedProjectError);
  });
});
