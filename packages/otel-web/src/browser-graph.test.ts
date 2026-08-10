// @vitest-environment node
//
// Decision (2026-08-05 server spec): the browser entry's module graph must
// stay provably free of the OTel API and the otel-errors dependency;
// only the server entry (server.ts, behind the "node" export condition) may
// touch them. The size gate would only hint at a leak; this walks the
// static import graph and fails loudly instead.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["@opentelemetry/", "@everr/otel-errors"];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  // Static import/export-from declarations; type-only ones are erased at
  // build time and never land in the bundle, so they are skipped.
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
