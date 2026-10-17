import { appAliases, appDirectory, installationComposition, type AppComposition } from "./vite.app.ts";
import { parse } from "dotenv";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import svgr from "vite-plugin-svgr";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function createAppTestConfig(
  composition: AppComposition = installationComposition,
  root = appDirectory,
) {
  return defineConfig({
    root,
    resolve: {
      tsconfigPaths: true,
      dedupe: ["react", "react-dom", "@tanstack/react-start", "@tanstack/react-router", "@tanstack/react-query"],
      alias: [
        ...appAliases(composition),
        { find: /^@\/(.*)$/, replacement: `${appDirectory}src/$1` },
      ],
    },
    plugins: [viteReact(), svgr({ svgrOptions: { dimensions: false } })],
    test: {
      environment: "jsdom",
      setupFiles: [join(appDirectory, "src/test-setup.ts")],
      reporters: ["verbose"],
      env: parse(readFileSync(join(appDirectory, ".env.example"), "utf8")),
    },
  });
}

export default createAppTestConfig();
