import { createHash, randomBytes } from "node:crypto";

const ACCESS_TOKEN_PREFIX = "eacc_";
const TOKEN_PREFIX_LENGTH = 16;

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function generateAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${toBase64Url(randomBytes(32))}`;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getAccessTokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export function obfuscateAccessTokenPrefix(tokenPrefix: string): string {
  return `${tokenPrefix}********`;
}
