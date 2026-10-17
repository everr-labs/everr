import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppComposition } from "@everr/app/build/composition";

export const cloudComposition: AppComposition = {
  cssSources: [resolve(import.meta.dirname, "./src")],
  adapters: resolve(import.meta.dirname, "./src/app"),
  composition: resolve(import.meta.dirname, "./src/composition"),
  routes: resolve(import.meta.dirname, "./src/routes"),
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};
