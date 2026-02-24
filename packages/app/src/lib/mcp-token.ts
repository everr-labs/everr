import { createHash, randomBytes } from "node:crypto";

const MCP_TOKEN_PREFIX = "ctmcp_";
const TOKEN_PREFIX_LENGTH = 16;

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function generateMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${toBase64Url(randomBytes(32))}`;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getMcpTokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export function obfuscateMcpTokenPrefix(tokenPrefix: string): string {
  return `${tokenPrefix}********`;
}
