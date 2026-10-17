import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appDirectory = `${import.meta.dirname}/`;

/** Build-time inputs supplied by the application that composes the product. */
export interface AppComposition {
  modules: Record<
    "server" | "client" | "product" | "navigation" | "dashboards",
    string
  > & { ui?: string };
  routes: string;
  routeTree: string;
  cssSources?: string[];
  serverEntries?: Record<string, string>;
}

export const installationComposition: AppComposition = {
  serverEntries: {
    recovery: fileURLToPath(
      new URL("./src/app/commands/recovery.ts", import.meta.url),
    ),
  },
  modules: {
    server: fileURLToPath(
      new URL("./src/app/composition/server.ts", import.meta.url),
    ),
    client: fileURLToPath(
      new URL("./src/app/composition/client.tsx", import.meta.url),
    ),
    product: fileURLToPath(
      new URL("./src/app/composition/product.ts", import.meta.url),
    ),
    navigation: fileURLToPath(
      new URL("./src/app/composition/navigation.ts", import.meta.url),
    ),
    dashboards: fileURLToPath(
      new URL("./src/app/composition/dashboards.ts", import.meta.url),
    ),
  },
  routes: resolve(import.meta.dirname, "./src/app/routes/"),
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};

export function appAliases(
  composition: AppComposition = installationComposition,
) {
  return [
    ...Object.entries({
      ui: fileURLToPath(new URL("./src/product/ui.tsx", import.meta.url)),
      ...composition.modules,
    }).map(([name, entry]) => ({
      find: `@composition/${name}`,
      replacement: entry,
    })),
    { find: "@composition/routes", replacement: composition.routeTree },
  ];
}

export function appRoutes(composition: AppComposition) {
  return {
    routesDirectory: resolve(import.meta.dirname, "./src"),
    generatedRouteTree: composition.routeTree,
    routeFileIgnorePattern: "\\.test\\.",
    virtualRouteConfig: {
      type: "root" as const,
      file: "routes/__root.tsx",
      children: [
        { type: "physical" as const, directory: "routes", pathPrefix: "" },
        {
          type: "physical" as const,
          directory: composition.routes,
          pathPrefix: "",
        },
      ],
    },
  };
}
