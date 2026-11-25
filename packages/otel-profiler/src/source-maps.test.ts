import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadSourceMaps } from "./source-maps.js";

// A bundled chunk whose name Node escapes in its module URL, with a map that
// points its first line at a TypeScript source.
function bundleDir() {
  const dir = mkdtempSync(join(tmpdir(), "otel-profiler-maps-"));
  const chunk = join(dir, "client+[...].mjs");
  writeFileSync(chunk, "export function handler() {}\n//# sourceMappingURL=client+[...].mjs.map\n");
  writeFileSync(
    `${chunk}.map`,
    JSON.stringify({
      version: 3,
      file: "client+[...].mjs",
      sources: ["../src/handler.ts"],
      names: [],
      mappings: "AAAA",
    }),
  );
  return { dir, chunk };
}

describe("loadSourceMaps", () => {
  it("maps a frame whose file name is escaped in its module URL", async () => {
    const { dir, chunk } = bundleDir();
    // What pprof passes for an ES module: the URL with `file://` cut off.
    const file = pathToFileURL(chunk).href.slice("file://".length);
    expect(file).toContain("%5B");

    const mapper = await loadSourceMaps([dir]);
    const location = mapper?.mappingInfo({ file, line: 1, column: 1, name: "handler" });
    expect(location?.file).toBe(join(dir, "..", "src", "handler.ts"));
  });
});
