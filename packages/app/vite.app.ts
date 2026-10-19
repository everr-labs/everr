import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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
  routes: Partial<Record<keyof typeof routeMounts, RegisteredRoute[]>>;
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
};

const compositionNames = [
  "storage",
  "identity",
  "server",
  "client",
  "product",
  "navigation",
  "dashboards",
  "ui",
  "pages",
  "layouts",
  "routes",
] as const;

/** Each application declares its own complete module selection in tsconfig. */
function compositionPaths(composition: AppComposition) {
  const file = resolve(composition.directory, "tsconfig.json");
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error)
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    composition.directory,
    undefined,
    file,
  );
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n"),
        )
        .join("\n"),
    );
  const paths = config.compilerOptions?.paths;
  const names = compositionNames.map((name) => `@composition/${name}`);
  for (const name of Object.keys(paths ?? {})) {
    if (name.startsWith("@composition/") && !names.includes(name))
      throw new Error(`Unknown composition module: ${name}`);
  }
  const entries = Object.fromEntries(
    names.map((name) => {
      const targets = paths?.[name];
      if (
        !Array.isArray(targets) ||
        targets.length !== 1 ||
        typeof targets[0] !== "string"
      )
        throw new Error(`${file}: ${name} must map to exactly one path`);
      const target = targets[0];
      if (target.includes("*"))
        throw new Error(`${file}: invalid path for ${name}`);
      const entry = resolve(
        composition.directory,
        parsed.options.baseUrl ?? ".",
        target,
      );
      assertOwnedFile(composition, entry, name === "@composition/routes");
      return [name, entry];
    }),
  );
  for (const entry of Object.values(composition.serverEntries ?? {}))
    assertOwnedFile(composition, entry);
  return entries;
}

export function appAliases(composition = installationComposition) {
  return Object.entries(compositionPaths(composition)).map(([name, entry]) => ({
    find: name,
    replacement: entry,
  }));
}

function assertOwnedFile(
  composition: AppComposition,
  file: string,
  generated = false,
) {
  if (!generated && !existsSync(file))
    throw new Error(`Composition entry does not exist: ${file}`);
  const path = relative(
    realpathSync(composition.directory),
    existsSync(file)
      ? realpathSync(file)
      : resolve(realpathSync(dirname(file)), basename(file)),
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
    generatedRouteTree: compositionPaths(composition)["@composition/routes"],
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
