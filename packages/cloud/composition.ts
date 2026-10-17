import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppComposition } from "@everr/app/build/composition";

export const cloudComposition: AppComposition = {
  cssSources: [resolve(import.meta.dirname, "./src")],
  modules: {
    server: fileURLToPath(new URL("./src/runtime.ts", import.meta.url)),
    client: fileURLToPath(
      new URL("./src/composition/client.tsx", import.meta.url),
    ),
    product: fileURLToPath(
      new URL("./src/composition/product.ts", import.meta.url),
    ),
    ui: fileURLToPath(new URL("./src/composition/ui.ts", import.meta.url)),
    navigation: fileURLToPath(new URL("./src/navigation.ts", import.meta.url)),
    dashboards: fileURLToPath(new URL("./src/dashboards.ts", import.meta.url)),
  },
  routes: resolve(import.meta.dirname, "./src/routes"),
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};
