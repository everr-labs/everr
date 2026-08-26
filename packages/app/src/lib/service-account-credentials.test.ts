import { describe, expect, it } from "vitest";
import {
  generateSecret,
  generateToken,
  hashCredential,
  isServiceAccountToken,
  SECRET_PREFIX,
  TOKEN_PREFIX,
} from "./service-account-credentials";

describe("generateSecret", () => {
  it("issues a prefixed value whose hash is not the value", () => {
    const secret = generateSecret();

    expect(secret.value.startsWith(SECRET_PREFIX)).toBe(true);
    expect(secret.hash).not.toContain(secret.value);
    expect(secret.hash).toBe(hashCredential(secret.value));
  });

  it("issues a different value every time", () => {
    expect(generateSecret().value).not.toBe(generateSecret().value);
  });

  it("keeps a start long enough to tell two secrets apart", () => {
    const secret = generateSecret();

    expect(secret.value.startsWith(secret.start)).toBe(true);
    expect(secret.start.length).toBeGreaterThan(SECRET_PREFIX.length);
  });
});

describe("generateToken", () => {
  it("issues a prefixed value recognised as a service account token", () => {
    const token = generateToken();

    expect(token.value.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(isServiceAccountToken(token.value)).toBe(true);
  });
});

describe("isServiceAccountToken", () => {
  it("rejects a secret, so a secret can never be used as a token", () => {
    expect(isServiceAccountToken(generateSecret().value)).toBe(false);
  });
});
