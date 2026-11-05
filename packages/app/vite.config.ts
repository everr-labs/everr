import { createRequire } from "node:module";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite-plus";
import svgr from "vite-plugin-svgr";
import { migrationAssets } from "./build/migrations.ts";
import {
  type AppComposition,
  appAliases,
  appDirectory,
  appRoutes,
  installationComposition,
} from "./vite.app.ts";
import { smeeWebhookPlugin } from "./vite.smee.ts";

export function createAppConfig(
  composition: AppComposition = installationComposition,
  outputDirectory = resolve(appDirectory, ".output"),
) {
  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    // The composed server reads process.env; load its package configuration
    // without overriding values injected by the development runner.
    for (const [name, value] of Object.entries(env)) {
      process.env[name] ??= value;
    }
    const require = createRequire(import.meta.url);

    return {
      root: appDirectory,
      envDir: process.cwd(),
      cacheDir: resolve(process.cwd(), "node_modules/.vite"),
      publicDir: resolve(appDirectory, "public"),
      // Prerender fetches must reach the preview listener inside IPv4-only containers.
      preview: { host: "127.0.0.1" },
      resolve: {
        tsconfigPaths: true,
        dedupe: [
          "react",
          "react-dom",
          "@tanstack/react-start",
          "@tanstack/react-router",
          "@tanstack/react-query",
        ],
        alias: [
          ...appAliases(composition),
          // tslib gets pulled in by Radix UI on SSR. Nitro/Rollup wraps tslib's
          // CJS as `__toESM(tslib).default` and destructures helpers off `.default`,
          // which is undefined — crashing route loaders with "Cannot destructure
          // property '__extends'". Pin to the ESM file directly to bypass the
          // CJS interop path entirely.
          {
            find: /^tslib$/,
            replacement: require.resolve("tslib/tslib.es6.mjs"),
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
            replacement: new URL("src/ssr-shims/use-sync-external-store-shim.ts", import.meta.url)
              .pathname,
          },
        ],
      },
      plugins: [
        {
          name: "app-composition-css",
          enforce: "pre",
          transform(code, id) {
            if (
              id.includes("?url") ||
              id.split("?")[0] !== resolve(appDirectory, "src/styles/app.css")
            )
              return;
            return (
              code +
              (composition.cssSources ?? []).map((source) => `\n@source "${source}";`).join("")
            );
          },
        },
        smeeWebhookPlugin({
          channel: env.SMEE_CHANNEL,
        }),
        devtools(),
        tailwindcss(),
        tanstackStart({
          spa: {
            enabled: true,
          },
          router: appRoutes(composition),
        }),
        migrationAssets({
          ".": resolve(appDirectory, "drizzle"),
          ...composition.migrationHistories,
        }),
        nitro({
          output: { dir: outputDirectory },
          traceDeps: ["tslib*"],
          hooks: {
            "rollup:before": (nitro, config) => {
              if (!composition.serverEntries || nitro.options.dev) return;
              config.input = {
                index: nitro.options.entry,
                ...composition.serverEntries,
              };
              const outputs = Array.isArray(config.output) ? config.output : [config.output];
              for (const output of outputs) {
                if (output) output.entryFileNames = "[name].mjs";
              }
            },
          },
        }),
        viteReact(),
        // dimensions: false drops the svg's fixed width/height, so the icon
        // scales from its viewBox and CSS classes own the size everywhere.
        svgr({ svgrOptions: { dimensions: false } }),
      ],
    };
  });
}

export default createAppConfig();
