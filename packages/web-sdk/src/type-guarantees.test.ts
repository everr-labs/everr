import { describe, expect, it } from "vitest";
import { init } from "./client.js";
import type {
  ConsentedClient,
  CookielessClient,
  CookielessInitOptions,
} from "./types.js";

// Compile-time guarantees for the dual-mode API. The interesting assertions
// are the `@ts-expect-error` lines, enforced by `tsc --noEmit` (tests are
// included in the typecheck); the runtime block only references the values so
// vitest and noUnusedLocals stay happy.

const rejectsIdentity: CookielessInitOptions = {
  mode: "cookieless",
  serviceName: "x",
  // @ts-expect-error - cookieless options have no identity fields
  visitorId: "v",
};

const rejectsReplay: CookielessInitOptions = {
  mode: "cookieless",
  serviceName: "x",
  // @ts-expect-error - cookieless options have no replay fields
  replay: { sampleRate: 1 },
};

// Overload resolution: cookieless options yield the cookieless handle.
const viaInit = (options: CookielessInitOptions) => init(options);
type CookielessReturn = ReturnType<typeof viaInit>;

const handle = null as unknown as CookielessReturn;
const isCookieless: CookielessClient = handle;
// @ts-expect-error - the cookieless handle is not a ConsentedClient
const notConsented: ConsentedClient = handle;

describe("type guarantees", () => {
  it("hold at compile time", () => {
    expect(rejectsIdentity.mode).toBe("cookieless");
    expect(rejectsReplay.mode).toBe("cookieless");
    expect(isCookieless).toBeNull();
    expect(notConsented).toBeNull();
    expect(viaInit).toBeTypeOf("function");
  });
});
