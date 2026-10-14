import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export function appAliases(mode: string) {
  const directory = mode === "cloud" ? "./src/cloud/app/" : "./src/app/";
  return [{
    find: /^@app\/(.*)$/,
    replacement: `${fileURLToPath(new URL(directory, import.meta.url))}$1`,
  }];
}

// Enforce the seam on the compiled graph, including external dependencies.
export function selfHostedIsolation(mode: string): Plugin {
  return {
    name: "self-hosted-isolation",
    apply: "build",
    generateBundle() {
      if (mode === "cloud") return;
      for (const id of this.getModuleIds()) {
        if (id.includes("@polar-sh/") || /\/src\/cloud\//.test(id)) {
          this.error(`Cloud implementation reached the self-hosted build: ${id}`);
        }
      }
    },
  };
}

// Both trees are generated independently so switching builds never rewrites the
// other composition's types. Cloud adds leaves under the product's layouts.
export function appRoutes(mode: string) {
  return {
    routesDirectory: ".",
    generatedRouteTree: mode === "cloud" ? "cloud/routeTree.gen.ts" : "routeTree.gen.ts",
    routeFileIgnorePattern: "\\.test\\.",
    virtualRouteConfig: {
      type: "root" as const,
      file: "routes/__root.tsx",
      children: [
        { type: "physical" as const, directory: "routes", pathPrefix: "" },
        { type: "physical" as const, directory: mode === "cloud" ? "cloud/routes" : "app/routes", pathPrefix: "" },
      ],
    },
  };
}
