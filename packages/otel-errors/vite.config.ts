import { defineConfig } from "vite-plus";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    entry: {
      node: "src/node.ts",
      core: "src/core.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    platform: "neutral",
    external: [/^@opentelemetry\//, /^node:/],
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageVersion),
    },
  },
});
