import { defineConfig } from "tsdown";

const packageVersion = process.env.npm_package_version ?? "0.0.0-dev";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    server: "src/server.ts",
    // The two targets of the "#report" subpath. The react bundle keeps the
    // "#report" import, and the resolver of the consumer selects one of these
    // files for the runtime. Thus the build must emit them as entries.
    "report.browser": "src/report.browser.ts",
    "report.server": "src/report.server.ts",
  },
  // The bundle must keep the "#report" import. If the build resolves it, the
  // react bundle contains the module of one runtime, and the selection by the
  // consumer is lost.
  external: ["#report"],
  format: ["esm"],
  dts: true,
  platform: "browser",
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageVersion),
  },
});
