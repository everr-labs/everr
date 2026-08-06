import { vi } from "vitest";

/**
 * Makes every media query match. The Explore rail then shows the form it uses
 * below 1024px: a "Filters" button and a sheet.
 *
 * jsdom supplies matchMedia but does not evaluate the query. It always reports
 * `matches: false`, which gives the wide layout. Tests of the wide layout
 * therefore need no stub, and only tests of the narrow layout call this.
 *
 * Call `vi.unstubAllGlobals()` in afterEach.
 */
export function stubNarrowViewport() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}
