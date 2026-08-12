import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeError, safeStringify } from "./normalize.js";

// Property tests for the normalization. JavaScript can throw many types of
// value. For each of them, normalizeError must not throw an error, and it must
// always make the structure that contains only strings. This is true for each
// stack, each chain of causes, and each value.

describe("normalizeError", () => {
  it("never throws and always returns string type and message", () => {
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        const normalized = normalizeError(thrown);
        expect(typeof normalized.type).toBe("string");
        expect(normalized.type.length).toBeGreaterThan(0);
        expect(typeof normalized.message).toBe("string");
      }),
    );
  });

  it("keeps type and message intact under arbitrary stack strings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (message, stack) => {
        const error = new Error(message);
        error.stack = stack;
        const normalized = normalizeError(error);
        expect(normalized.type).toBe("Error");
        expect(normalized.message).toBe(message);
        expect(typeof normalized.stacktrace).toBe("string");
      }),
    );
  });

  it("renders every cause message in an arbitrary-depth chain, up to the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 8 }),
        (messages) => {
          const [head, ...rest] = messages;
          let error = new Error(head);
          const root = error;
          for (const message of rest) {
            const cause = new Error(message);
            error.cause = cause;
            error = cause;
          }
          const normalized = normalizeError(root);
          // Depth 0 is the root. Thus the limit permits the first 6 messages.
          for (const message of messages.slice(0, 6)) {
            expect(normalized.stacktrace).toContain(message);
          }
        },
      ),
    );
  });

  it("terminates on cyclic cause chains", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    expect(() => normalizeError(a)).not.toThrow();
  });
});

describe("safeStringify", () => {
  it("returns a string for anything, including throwing getters", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof safeStringify(value)).toBe("string");
      }),
    );
    const hostile = {
      get boom(): never {
        throw new Error("boom");
      },
      toJSON(): never {
        throw new Error("boom");
      },
    };
    expect(typeof safeStringify(hostile)).toBe("string");
  });

  it("is the identity on strings", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(safeStringify(value)).toBe(value);
      }),
    );
  });
});
