import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { NitroConfig } from "nitro/types";

const SERVICE_OUTPUT = /[/\\]\.nitro[/\\]vite[/\\]services[/\\].+\.m?js$/;
const SOURCE_MAPPING_URL = /\n\/\/# sourceMappingURL=[^\n]*\s*$/;

type RolldownPlugins = NonNullable<NonNullable<NitroConfig["rolldownConfig"]>["plugins"]>;

/**
 * Nitro options for server source maps the profiler can resolve frames with,
 * ours and the libraries'. A workaround for Nitro's Vite builder (EVE-102):
 * once Nitro chains its input maps and keeps user-code mappings, delete this
 * file and the spread of it in vite.config.ts.
 *
 * Nitro bundles the server a second time from Vite's SSR output and does not
 * read that output's maps, so its own maps would stop at the intermediate
 * files. Handing each intermediate file to the bundler with its map chains the
 * maps back to the TypeScript sources.
 *
 * Nitro's own map minifier is off, since it empties the mappings of every chunk
 * built from node_modules. This drops only the embedded sources instead: the
 * profiler needs positions, not source text, and they would double the output.
 */
export function serverSourceMaps(): Pick<NitroConfig, "experimental" | "rolldownConfig"> {
  return {
    experimental: { sourcemapMinify: false },
    // An array, so Nitro's merge appends it to its own plugins.
    rolldownConfig: { plugins: [chainServerSourceMaps()] },
  };
}

function chainServerSourceMaps(): RolldownPlugins {
  let chained = 0;
  return {
    name: "everr:server-source-maps",
    async load(id: string) {
      if (!SERVICE_OUTPUT.test(id) || !existsSync(`${id}.map`)) return null;
      const [code, map] = await Promise.all([readFile(id, "utf8"), readFile(`${id}.map`, "utf8")]);
      chained++;
      return { code: code.replace(SOURCE_MAPPING_URL, "\n"), map };
    },
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (!fileName.endsWith(".map") || asset.type !== "asset") continue;
        if (typeof asset.source !== "string") continue;
        const map = JSON.parse(asset.source);
        if (!("sourcesContent" in map)) continue;
        delete map.sourcesContent;
        asset.source = JSON.stringify(map);
      }
      // Nothing chained means Nitro moved its Vite output, and the maps would
      // silently point at bundle files again.
      if (chained === 0) {
        this.error(
          "No Vite SSR output was loaded with its source map, so server frames in profiles would point at bundle files. Check where Nitro writes its Vite output (EVE-102).",
        );
      }
    },
  };
}
