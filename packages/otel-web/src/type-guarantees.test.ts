import { describe, expect, it } from "vitest";
import { identify, revoke } from "./identity.js";
import type { InitOptions } from "./types.js";

// Compile-time guarantees for the public API. The interesting assertions
// are the `@ts-expect-error` lines, enforced by `tsc --noEmit` (tests are
// included in the typecheck); the runtime block only references the values so
// vitest and noUnusedLocals stay happy.

const rejectsUnknownPersistence: InitOptions = {
  serviceName: "x",
  // @ts-expect-error - persistence is "localStorage" or "memory", nothing else
  persistence: "cookies",
};

const persistenceIsOptional: InitOptions = {
  serviceName: "x",
};

// identify()/revoke() work like the rest of the public API (captureError,
// logger): package-level functions, not methods on the returned handle.
function identifyAndRevokeAreFreeFunctions(): void {
  identify("u_123");
  identify("u_123", { plan: "pro", company: { name: "Acme" } });
  identify("u_123", {
    // @ts-expect-error - trait values are scalars or nested objects, never arrays
    tags: ["a", "b"],
  });
  revoke();
}

describe("type guarantees", () => {
  it("hold at compile time", () => {
    expect(rejectsUnknownPersistence.serviceName).toBe("x");
    expect(persistenceIsOptional.persistence).toBeUndefined();
    expect(identifyAndRevokeAreFreeFunctions).toBeTypeOf("function");
  });
});
