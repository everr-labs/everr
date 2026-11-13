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
      index: "src/index.ts",
      react: "src/react.ts",
      server: "src/server.ts",
      recording: "src/recording.ts",
      // A separate entry keeps rrweb out of the stub. The stub imports it on
      // demand.
      "recording/recorder": "src/recording/recorder.ts",
    },
    // The react and recording bundles must keep their import of the package name. If the build
    // resolves it, the react bundle contains the entry of one runtime, and the
    // selection by the "." export conditions of the consumer is lost.
    external: ["@everr/otel-web"],
    format: ["esm"],
    dts: true,
    platform: "browser",
    define: {
      __PACKAGE_VERSION__: JSON.stringify(packageVersion),
    },
  },
});
