import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const browserTelemetryEnabled = mode === "development";
  const browserTelemetryEndpoint =
    env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    "http://127.0.0.1:54318";

  return {
    define: {
      __EVERR_BROWSER_OTEL__: JSON.stringify({
        enabled: browserTelemetryEnabled,
        endpoint: browserTelemetryEnabled ? browserTelemetryEndpoint : "",
        serviceName: "everr-web-browser",
      }),
    },
    server: {
      allowedHosts: ["host.docker.internal"],
      host: "0.0.0.0",
      port: 5173,
    },
    resolve: {
      tsconfigPaths: true,
      alias: [
        // tslib gets pulled in by Radix UI on SSR. Nitro/Rollup wraps tslib's
        // CJS as `__toESM(tslib).default` and destructures helpers off `.default`,
        // which is undefined — crashing route loaders with "Cannot destructure
        // property '__extends'". Pin to the ESM file directly to bypass the
        // CJS interop path entirely.
        {
          find: /^tslib$/,
          replacement: "tslib/tslib.es6.mjs",
        },
        // use-sync-external-store is a CJS shim that does require("react") which
        // Rollup can't inline for SSR, causing "Cannot find module 'react'" in
        // production. React 19 exports useSyncExternalStore natively, so we
        // redirect to our thin ESM wrappers that import from react directly.
        {
          find: "use-sync-external-store/shim/with-selector",
          replacement: new URL(
            "src/ssr-shims/use-sync-external-store-with-selector.ts",
            import.meta.url,
          ).pathname,
        },
        {
          find: "use-sync-external-store/shim",
          replacement: new URL(
            "src/ssr-shims/use-sync-external-store-shim.ts",
            import.meta.url,
          ).pathname,
        },
      ],
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackStart({
        spa: {
          enabled: true,
        },
        router: {
          routeFileIgnorePattern: "\\.test\\.",
        },
      }),
      nitro(),
      viteReact(),
    ],
  };
});

export default config;
