import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadSourceMaps } from "./source-maps.js";

// A bundled file with a map that points its first line at a TypeScript source.
function bundleDir(name: string) {
  const dir = mkdtempSync(join(tmpdir(), "otel-profiler-maps-"));
  const chunk = join(dir, name);
  writeFileSync(chunk, `export function handler() {}\n//# sourceMappingURL=${name}.map\n`);
  writeFileSync(
    `${chunk}.map`,
    JSON.stringify({
      version: 3,
      file: name,
      sources: ["../src/handler.ts"],
      names: [],
      mappings: "AAAA",
    }),
  );
  return { dir, chunk };
}

describe("loadSourceMaps", () => {
  it("maps a frame whose file name is escaped in its module URL", async () => {
    // Node escapes the brackets in the module URL.
    const { dir, chunk } = bundleDir("client+[...].mjs");
    // What pprof passes for an ES module: the URL with `file://` cut off.
    const file = pathToFileURL(chunk).href.slice("file://".length);
    expect(file).toContain("%5B");

    const mapper = await loadSourceMaps([dir]);
    const location = mapper?.mappingInfo({ file, line: 1, column: 1, name: "handler" });
    expect(location?.file).toBe(join(dir, "..", "src", "handler.ts"));
  });

  it("maps a CommonJS file whose name holds a literal percent sign", async () => {
    // Decoding this path first would turn `%41` into `A` and miss the map.
    const { dir, chunk } = bundleDir("report%41.js");

    const mapper = await loadSourceMaps([dir]);
    const location = mapper?.mappingInfo({ file: chunk, line: 1, column: 1, name: "handler" });
    expect(location?.file).toBe(join(dir, "..", "src", "handler.ts"));
  });
});
