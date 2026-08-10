// @vitest-environment node
//
// The team made this decision on 2026-08-05 in the server specification. The
// module graph of the browser entry must contain no OTel API and no otel-errors
// dependency, and a test must show this. Only the server entry, server.ts behind
// the "node" export condition, can use them. A test of the build size gives only
// an indication of a problem. Thus this test reads the graph of the static
// imports, and it fails with a clear message.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["@opentelemetry/", "@everr/otel-errors"];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  // The static import declarations and the export-from declarations. The build
  // removes the declarations for the types only, and they are never in the
  // bundle. Thus this test ignores them.
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^"']*?from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[1]) specifiers.push(match[2]);
  }
  return specifiers;
}

function walk(
  entry: string,
  graph = new Map<string, string[]>(),
): Map<string, string[]> {
  const file = resolve(entry);
  if (graph.has(file)) return graph;
  const specifiers = importsOf(file);
  graph.set(file, specifiers);
  for (const spec of specifiers) {
    if (spec.startsWith(".")) {
      walk(resolve(dirname(file), spec.replace(/\.js$/, ".ts")), graph);
    }
  }
  return graph;
}

describe("browser module graph", () => {
  for (const entry of ["src/index.ts", "src/react.ts"]) {
    it(`${entry} never imports the OTel API or otel-errors`, () => {
      for (const [file, specifiers] of walk(entry)) {
        for (const spec of specifiers) {
          for (const forbidden of FORBIDDEN) {
            expect(spec, `${file} imports ${spec}`).not.toContain(forbidden);
          }
        }
      }
    });
  }

  it("the walker sees through the server entry (self-check)", () => {
    const specs = [...walk("src/server.ts").values()].flat();
    expect(specs.some((s) => s.startsWith("@opentelemetry/"))).toBe(true);
  });
});
