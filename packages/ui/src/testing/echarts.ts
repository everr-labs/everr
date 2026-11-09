import type * as echarts from "echarts/core";
import { vi } from "vite-plus/test";

/**
 * Factory for `vi.mock("echarts/core", ...)`: every `init` gets a server-side
 * SVG chart of a fixed size, so tests exercise the real ECharts layout without a
 * browser canvas. Import it dynamically inside the factory, which is hoisted
 * above static imports.
 */
export async function ssrEChartsCore(importOriginal: () => Promise<unknown>, height = 300) {
  const core = (await importOriginal()) as typeof echarts;
  const { SVGRenderer } = await import("echarts/renderers");
  core.use([SVGRenderer]);
  return {
    ...core,
    init: vi.fn(() =>
      core.init(null, undefined, { renderer: "svg", ssr: true, width: 600, height }),
    ),
  };
}
