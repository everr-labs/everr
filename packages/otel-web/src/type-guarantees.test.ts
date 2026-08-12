import { describe, expect, it } from "vitest";
import { identify, revoke } from "./state/session.js";
import type { WebSDKOptions } from "./types.js";

// The rules of the public API that the compiler applies. The important tests
// are the `@ts-expect-error` lines. The `tsc --noEmit` command examines them,
// because the typecheck includes the tests. The code below uses the values only
// to satisfy vitest and the noUnusedLocals option.

const rejectsUnknownPersistence: WebSDKOptions = {
  serviceName: "x",
  // @ts-expect-error - the persistence is "localStorage" or "memory" only
  persistence: "cookies",
};

const persistenceIsOptional: WebSDKOptions = {
  serviceName: "x",
};

// The identify() and revoke() functions operate in the same way as the other
// parts of the public API, which are captureError and logger. They are package
// functions, and they are not methods on the object that the constructor
// returns.
function identifyAndRevokeAreFreeFunctions(): void {
  identify("u_123");
  identify("u_123", { plan: "pro", "company.name": "Acme" });
  identify("u_123", {
    // @ts-expect-error - a trait value is a single value and never an array
    tags: ["a", "b"],
  });
  identify("u_123", {
    // @ts-expect-error - a trait value is a single value and never an object
    company: { name: "Acme" },
  });
  revoke();
}

// The browser entry and the server entry are two files, and one module
// specifier gives them, through the conditional exports in package.json. Thus
// each public function of one entry must have the same type as the equivalent
// function of the other entry. Shared code then sees one API.
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
