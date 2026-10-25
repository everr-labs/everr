// @vitest-environment node
import { expect, it, vi } from "vite-plus/test";
import type { EventInput } from "#app/composition/events.ts";
import { safeEventPublisher } from "./safe-publication";

const fact = { type: "verification.created", version: 1, subjectId: "id", data: {} };
const definitions = [{ type: fact.type, version: 1, parse: () => fact }];

it.each([
  ["throw", "throw"],
  ["throw", "reject"],
  ["reject", "throw"],
  ["reject", "reject"],
])("contains injected publication %s and reporter %s", async (publication, reporting) => {
  const diagnostics = vi.fn(() => {
    if (reporting === "throw") throw new Error("reporter broken");
    return Promise.reject(new Error("reporter broken"));
  });
  const { publish } = safeEventPublisher(
    {
      publish() {
        if (publication === "reject")
          return Promise.reject(new Error("private profile")) as unknown as void;
        throw new Error("private profile");
      },
    },
    definitions,
    diagnostics,
  );
  expect(() => publish(fact)).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(diagnostics).toHaveBeenCalledExactlyOnceWith({
    eventType: fact.type,
    subscriberId: "publisher",
    stage: "publication",
    error: expect.objectContaining({ message: "Business event publication failed" }),
  });
  expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("private profile");
});

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
    const diagnostics = vi.fn();
    const events = safeEventPublisher(
      { publish: () => Promise.reject(new Error("private body")) as unknown as void },
      definitions,
      diagnostics,
    );
    expect(() => events.publish(input() as EventInput)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ eventType: "unknown" }));
  },
);

it("calls the injected publisher once and returns without waiting for completion", () => {
  const publish = vi.fn(() => new Promise<void>(() => {}) as unknown as void);
  const events = safeEventPublisher({ publish }, definitions);
  expect(events.publish(fact)).toBeUndefined();
  expect(publish).toHaveBeenCalledExactlyOnceWith(fact);
});
