import {
  appAliases,
  appDirectory,
  installationComposition,
  type AppComposition,
} from "./vite.app.ts";
import { parse } from "dotenv";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import svgr from "vite-plugin-svgr";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const alertingIntegrationTests = [
  `${appDirectory}src/{data,server}/alerting/**/*.integration.test.ts`,
];

export function createAppTestConfig(
  composition: AppComposition = installationComposition,
  root = appDirectory,
) {
  return defineConfig({
    root,
    resolve: {
      tsconfigPaths: true,
      dedupe: [
        "@testing-library/react",
        "@testing-library/dom",
        "react",
        "react-dom",
        "@tanstack/react-start",
        "@tanstack/react-router",
        "@tanstack/react-query",
      ],
      alias: [...appAliases(composition)],
    },
    plugins: [viteReact(), svgr({ svgrOptions: { dimensions: false } })],
    test: {
      clearMocks: false,
      environment: "jsdom",
      setupFiles: [join(appDirectory, "src/test-setup.ts")],
      reporters: ["verbose"],
      env: parse(readFileSync(join(root, ".env.example"), "utf8")),
    },
  });
}

export default createAppTestConfig();
