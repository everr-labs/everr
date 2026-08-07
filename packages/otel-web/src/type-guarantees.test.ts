import { describe, expect, it } from "vitest";
import { identify, revoke } from "./session.js";
import type { WebSDKOptions } from "./types.js";

// Compile-time guarantees for the public API. The interesting assertions
// are the `@ts-expect-error` lines, enforced by `tsc --noEmit` (tests are
// included in the typecheck); the runtime block only references the values so
// vitest and noUnusedLocals stay happy.

const rejectsUnknownPersistence: WebSDKOptions = {
  serviceName: "x",
  // @ts-expect-error - persistence is "localStorage" or "memory", nothing else
  persistence: "cookies",
};

const persistenceIsOptional: WebSDKOptions = {
  serviceName: "x",
};

// identify()/revoke() work like the rest of the public API (captureError,
// logger): package-level functions, not methods on the returned handle.
function identifyAndRevokeAreFreeFunctions(): void {
  identify("u_123");
  identify("u_123", { plan: "pro", "company.name": "Acme" });
  identify("u_123", {
    // @ts-expect-error - trait values are flat scalars, never arrays
    tags: ["a", "b"],
  });
  identify("u_123", {
    // @ts-expect-error - trait values are flat scalars, never nested objects
    company: { name: "Acme" },
  });
  revoke();
}

// The browser and server entries are two files behind one module specifier
// (package.json conditional exports), so their public surfaces must stay
// mutually assignable: shared isomorphic code sees one API.
function entriesStayInLockstep(
  server: typeof import("./server.js"),
  browser: typeof import("./index.js"),
): void {
  const browserCoversServer: typeof server = browser;
  const serverCoversBrowser: typeof browser = server;
  void browserCoversServer;
  void serverCoversBrowser;
}

describe("type guarantees", () => {
  it("hold at compile time", () => {
    expect(rejectsUnknownPersistence.serviceName).toBe("x");
    expect(persistenceIsOptional.persistence).toBeUndefined();
    expect(identifyAndRevokeAreFreeFunctions).toBeTypeOf("function");
    expect(entriesStayInLockstep).toBeTypeOf("function");
  });
});
