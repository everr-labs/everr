import { vi } from "vitest";

// Installed by test-setup before the SDK captures fetch at module evaluation.
// Tests change its behavior without changing the captured function identity.
const transportFetch = vi.fn<typeof fetch>();

export function stubTransportFetch(implementation: typeof fetch): void {
  transportFetch.mockReset().mockImplementation(implementation);
  vi.stubGlobal("fetch", transportFetch);
}

/**
 * Reads the body that the SDK sent. A normal request is gzip encoded, so the
 * test decodes it before parsing the OTLP JSON. An exit request is a plain
 * string.
 */
export async function readOtlpBody(init?: RequestInit): Promise<string> {
  const body = init?.body;
  const bytes =
    body instanceof Uint8Array
      ? body
      : body instanceof Blob
        ? new Uint8Array(await body.arrayBuffer())
        : null;
  if (!bytes) return String(body ?? "");
  if (new Headers(init?.headers).get("Content-Encoding") !== "gzip") {
    return new TextDecoder().decode(bytes);
  }
  const Decompress = (
    globalThis as typeof globalThis & {
      __testDecompressionStream?: typeof DecompressionStream;
    }
  ).__testDecompressionStream;
  if (!Decompress) return new TextDecoder().decode(bytes);
  const stream = new Response(bytes).body;
  if (!stream) return "";
  return new Response(stream.pipeThrough(new Decompress("gzip"))).text();
}
