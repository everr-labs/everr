import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appDirectory = `${import.meta.dirname}/`;

/** Build-time inputs supplied by the application that composes the product. */
export interface AppComposition {
  adapters: string;
  composition: string;
  routes: string;
  routeTree: string;
  cssSources?: string[];
}

export const installationComposition: AppComposition = {
  adapters: resolve(import.meta.dirname, "./src/app/"),
  composition: resolve(import.meta.dirname, "./src/app/composition/"),
  routes: resolve(import.meta.dirname, "./src/app/routes/"),
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};

export function appAliases(composition: AppComposition = installationComposition) {
  return [
    ...["product", "ui"].map((entry) => ({
      find: `@composition/${entry}`,
      replacement: `${composition.composition}/${entry}.ts`,
    })),
    { find: "@composition/client", replacement: `${composition.composition}/client.tsx` },
    { find: /^@app\/(.*)$/, replacement: `${composition.adapters}/$1` },
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
        { type: "physical" as const, directory: composition.routes, pathPrefix: "" },
      ],
    },
  };
}
