import { vi } from "vitest";

// Installed by test-setup before the SDK captures fetch at module evaluation.
// Tests change its behavior without changing the captured function identity.
const transportFetch = vi.fn<typeof fetch>();

export function stubTransportFetch(implementation: typeof fetch): void {
  transportFetch.mockReset().mockImplementation(implementation);
  vi.stubGlobal("fetch", transportFetch);
}
