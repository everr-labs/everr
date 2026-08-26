import { createHash, randomBytes } from "node:crypto";

export const SECRET_PREFIX = "sa_";
export const TOKEN_PREFIX = "st_";
export const TOKEN_TTL_SECONDS = 3600;

const RANDOM_BYTES = 32;
const START_LENGTH = SECRET_PREFIX.length + 6;

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function generate(prefix: string): string {
  return `${prefix}${randomBytes(RANDOM_BYTES).toString("base64url")}`;
}

export function generateSecret() {
  const value = generate(SECRET_PREFIX);
  return {
    value,
    hash: hashCredential(value),
    start: value.slice(0, START_LENGTH),
  };
}

export function generateToken() {
  const value = generate(TOKEN_PREFIX);
  return { value, hash: hashCredential(value) };
}

export function isServiceAccountToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
}
