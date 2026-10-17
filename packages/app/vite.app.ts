import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appDirectory = `${import.meta.dirname}/`;

const routeMounts = {
  welcome: "/_welcome",
  signedIn: "/_welcome/_signedIn",
  organizationDashboard: "/_authenticated/_organization/_dashboard",
} as const;

/** URLs and nesting are explicit; source files can live anywhere in the package. */
export type RegisteredRoute = (
  | { type: "route"; path: string }
  | { type: "layout"; id: string }
) & { file: string; children?: RegisteredRoute[] };

/** Build-time inputs supplied by the application that composes the product. */
export interface AppComposition {
  directory: string;
  modules: Record<
    "server" | "client" | "product" | "navigation" | "dashboards",
    string
  > & { ui?: string; pages?: string };
  routes: Partial<Record<keyof typeof routeMounts, RegisteredRoute[]>>;
  routeTree: string;
  cssSources?: string[];
  serverEntries?: Record<string, string>;
}

export const installationComposition: AppComposition = {
  directory: appDirectory,
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
  routes: {
    welcome: [
      {
        type: "route",
        path: "setup",
        file: resolve(appDirectory, "src/app/routes/_welcome/setup.tsx"),
      },
    ],
    signedIn: [
      {
        type: "route",
        path: "access-required",
        file: resolve(
          appDirectory,
          "src/app/routes/_welcome/_signedIn/access-required.tsx",
        ),
      },
    ],
  },
  routeTree: fileURLToPath(new URL("./src/routeTree.gen.ts", import.meta.url)),
};

export function compositionModules(composition: AppComposition) {
  return {
    pages: fileURLToPath(new URL("./src/product/pages.ts", import.meta.url)),
    ui: fileURLToPath(new URL("./src/product/ui.tsx", import.meta.url)),
    ...composition.modules,
    routes: composition.routeTree,
  };
}

export function appAliases(composition = installationComposition) {
  return Object.entries(compositionModules(composition)).map(
    ([name, entry]) => ({
      find: `@composition/${name}`,
      replacement: entry,
    }),
  );
}

function assertOwnedFile(composition: AppComposition, file: string) {
  if (!existsSync(file))
    throw new Error(`Composition entry does not exist: ${file}`);
  const path = relative(
    realpathSync(composition.directory),
    realpathSync(file),
  );
  if (
    isAbsolute(path) ||
    path === ".." ||
    path.startsWith("../") ||
    path.startsWith("..\\") ||
    path.split(/[/\\]/).includes("node_modules")
  ) {
    throw new Error(
      `Composition entry must belong to its application package: ${file}`,
    );
  }
}

/** Generated config is committed for editors and refreshed before builds/checks. */
export function prepareComposition(composition: AppComposition) {
  for (const file of Object.values(composition.modules))
    assertOwnedFile(composition, file);
  for (const file of Object.values(composition.serverEntries ?? {}))
    assertOwnedFile(composition, file);
  const ownApp = resolve(composition.directory) === resolve(appDirectory);
  const modulePath = (file: string) => {
    const appRelative = relative(appDirectory, file);
    return !ownApp && !appRelative.startsWith("..")
      ? `./node_modules/@everr/app/${appRelative}`
      : `./${relative(composition.directory, file)}`;
  };
  const config = {
    compilerOptions: {
      paths: {
        "@/*": [ownApp ? "./src/*" : "./node_modules/@everr/app/src/*"],
        ...Object.fromEntries(
          Object.entries(compositionModules(composition)).map(
            ([name, file]) => [`@composition/${name}`, [modulePath(file)]],
          ),
        ),
      },
    },
  };
  const file = resolve(composition.directory, "tsconfig.composition.json");
  const content = `${JSON.stringify(config, null, 2)}\n`;
  if (!existsSync(file) || readFileSync(file, "utf8") !== content)
    writeFileSync(file, content);
}

export function appRoutes(composition: AppComposition) {
  const seen = new Set<string>();
  const register = (
    route: RegisteredRoute,
    parent: string,
  ): RegisteredRoute => {
    const segment = route.type === "layout" ? route.id : route.path;
    if (
      !segment ||
      segment.startsWith("/") ||
      segment.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`Invalid route segment: ${segment}`);
    const id = `${parent}/${segment}`;
    if (seen.has(id)) throw new Error(`Duplicate registered route: ${id}`);
    seen.add(id);
    assertOwnedFile(composition, route.file);
    return {
      ...route,
      file: relative(resolve(appDirectory, "src"), route.file),
      children: route.children?.map((child) => register(child, id)),
    };
  };
  const at = (mount: keyof typeof routeMounts) =>
    (composition.routes[mount] ?? []).map((route) =>
      register(route, routeMounts[mount]),
    );
  for (const mount of Object.keys(composition.routes)) {
    if (!(mount in routeMounts))
      throw new Error(`Unknown route attachment point: ${mount}`);
  }
  return {
    routesDirectory: resolve(appDirectory, "src"),
    generatedRouteTree: composition.routeTree,
    routeFileIgnorePattern: "\\.test\\.",
    virtualRouteConfig: {
      type: "root" as const,
      file: "routes/__root.tsx",
      children: [
        { type: "physical" as const, directory: "routes", pathPrefix: "" },
        {
          type: "layout" as const,
          id: "_welcome",
          file: "routes/-_welcome.tsx",
          children: [
            ...at("welcome"),
            {
              type: "layout" as const,
              id: "_signedIn",
              file: "routes/_welcome/-_signedIn.tsx",
              children: at("signedIn"),
            },
          ],
        },
        {
          type: "layout" as const,
          id: "_authenticated",
          file: "routes/-_authenticated.tsx",
          children: [
            {
              type: "layout" as const,
              id: "_dashboard",
              file: "routes/_authenticated/-_dashboard.tsx",
            },
            {
              type: "layout" as const,
              id: "_organization",
              file: "routes/_authenticated/-_organization.tsx",
              children: [
                {
                  type: "layout" as const,
                  id: "_dashboard",
                  file: "routes/_authenticated/_organization/-_dashboard.tsx",
                  children: at("organizationDashboard"),
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
