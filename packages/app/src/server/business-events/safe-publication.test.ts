// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";
import type { BusinessEventFact } from "#app/composition/business-events.ts";
import { safeBusinessEvents } from "./safe-publication";

const fact = { type: "verification.created", version: 1, subjectId: "id", data: {} };
const definitions = [{ type: fact.type, version: 1, parse: () => fact }];

it.each(["throw", "reject"])(
  "contains injected failure and independent diagnostic failures (%s)",
  async (failure) => {
    const diagnostics = {
      log: vi.fn(() => {
        throw new Error("logger broken");
      }),
      count: vi.fn(() => Promise.reject(new Error("counter broken"))),
    };
    const { publish } = safeBusinessEvents(
      {
        publish() {
          if (failure === "reject")
            return Promise.reject(new Error("private profile")) as unknown as void;
          throw new Error("private profile");
        },
      },
      definitions,
      diagnostics,
    );
    expect(() => publish(fact)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const emit of [diagnostics.log, diagnostics.count]) {
      expect(emit).toHaveBeenCalledOnce();
      expect(emit).toHaveBeenCalledWith({
        eventType: fact.type,
        subscriberId: "publisher",
        stage: "publication",
        error: expect.objectContaining({ message: "Business event publication failed" }),
      });
      expect(JSON.stringify(emit.mock.calls)).not.toContain("private profile");
    }
  },
);

it.each([
  ["null", (): unknown => null],
  [
    "getter",
    () => ({
      get type() {
        throw new Error("hostile getter");
      },
    }),
  ],
  ["unknown", () => ({ type: "unregistered-value" })],
] as const)(
  "contains malformed runtime facts with bounded diagnostics (%s)",
  async (_label, input) => {
    const diagnostics = { log: vi.fn(), count: vi.fn() };
    const events = safeBusinessEvents(
      { publish: () => Promise.reject(new Error("private body")) as unknown as void },
      definitions,
      diagnostics,
    );
    expect(() => events.publish(input() as BusinessEventFact)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnostics.count).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "unknown" }),
    );
  },
);

it("calls the injected publisher once and returns without waiting for completion", () => {
  const publish = vi.fn(() => new Promise<void>(() => {}) as unknown as void);
  const events = safeBusinessEvents({ publish }, definitions);
  expect(events.publish(fact)).toBeUndefined();
  expect(publish).toHaveBeenCalledExactlyOnceWith(fact);
});
