import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_PATTERNS,
  redactAttributeKeys,
  redactString,
  SENSITIVE_KEY_SNIPPETS,
  stripUrlQueryAndFragment,
} from "./redact.js";

// Property tests for the redaction. The filter on the keys keeps the full set
// of keys, and it only replaces a value with the redaction marker. The default
// patterns remove each secret that the test makes, at each position in a
// string.

const word = fc.stringMatching(/^[a-z]{1,8}$/);

describe("redactAttributeKeys", () => {
  const behavior = fc.oneof(
    fc.constant<boolean>(true),
    fc.constant<boolean>(false),
    fc.record({ allow: fc.array(word, { maxLength: 3 }) }),
    fc.record({ deny: fc.array(word, { maxLength: 3 }) }),
  );
  const data = fc.dictionary(word, fc.oneof(fc.string(), fc.integer()));

  it("preserves the key set and only substitutes the marker", () => {
    fc.assert(
      fc.property(data, behavior, (attrs, b) => {
        const out = redactAttributeKeys(attrs, b);
        expect(Object.keys(out).sort()).toEqual(Object.keys(attrs).sort());
        for (const key of Object.keys(out)) {
          expect([attrs[key], "[Filtered]"]).toContainEqual(out[key]);
        }
      }),
    );
  });

  it("filters every sensitive key regardless of behavior, except false", () => {
    const sensitiveKey = fc
      .tuple(fc.constantFrom(...SENSITIVE_KEY_SNIPPETS), word, word)
      .map(([snippet, before, after]) => `${before}_${snippet}_${after}`);
    fc.assert(
      fc.property(sensitiveKey, behavior, fc.string(), (key, b, value) => {
        const out = redactAttributeKeys({ [key]: value }, b);
        expect(out[key]).toBe(b === false ? value : "[Filtered]");
      }),
    );
  });

  it("with an allow-list, keeps only keys matching an allowed term", () => {
    fc.assert(
      fc.property(
        fc.dictionary(word, fc.string()),
        fc.array(word, { minLength: 1, maxLength: 3 }),
        (attrs, allow) => {
          const out = redactAttributeKeys(attrs, { allow });
          for (const key of Object.keys(attrs)) {
            const allowed = allow.some((t) => key.includes(t));
            if (!allowed) expect(out[key]).toBe("[Filtered]");
          }
        },
      ),
    );
  });
});

describe("redactString with the default patterns", () => {
  it("removes constructed email addresses wherever they appear", () => {
    const email = fc
      .tuple(word, word, fc.constantFrom("com", "io", "dev"))
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
    fc.assert(
      fc.property(word, email, word, (prefix, address, suffix) => {
        const out = redactString(
          `${prefix} ${address} ${suffix}`,
          DEFAULT_REDACT_PATTERNS,
        );
        expect(out).not.toContain(address);
        expect(out).toContain("[Filtered]");
      }),
    );
  });

  it("removes bearer tokens", () => {
    const token = fc.stringMatching(/^[A-Za-z0-9._-]{8,40}$/);
    fc.assert(
      fc.property(token, (t) => {
        const out = redactString(
          `Authorization: Bearer ${t}`,
          DEFAULT_REDACT_PATTERNS,
        );
        expect(out).toBe("Authorization: [Filtered]");
      }),
    );
  });

  it("filters sensitive query param values but keeps the param name", () => {
    const param = fc.constantFrom("token", "api_key", "password", "secret");
    // The secret contains only capital letters. Thus it is never the same as a
    // part of the URL text in small letters or a part of the [Filtered] marker.
    const value = fc.stringMatching(/^[A-Z0-9]{6,20}$/);
    fc.assert(
      fc.property(param, value, (p, v) => {
        const out = redactString(
          `https://example.com/cb?${p}=${v}&ok=1`,
          DEFAULT_REDACT_PATTERNS,
        );
        expect(out).toContain(`${p}=`);
        expect(out).not.toContain(v);
      }),
    );
  });
});

describe("stripUrlQueryAndFragment", () => {
  it("never leaves a query or fragment behind", () => {
    fc.assert(
      fc.property(fc.oneof(fc.webUrl(), fc.string()), (value) => {
        expect(stripUrlQueryAndFragment(value)).not.toMatch(/[?#]/);
      }),
    );
  });
});
