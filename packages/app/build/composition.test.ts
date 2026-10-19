// @vitest-environment node
import { Generator, getConfig } from "@tanstack/router-generator";
import {
  renameSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  appAliases,
  appDirectory,
  appRoutes,
  type AppComposition,
} from "../vite.app";

async function generateRoutes(composition: AppComposition) {
  const config = getConfig(appRoutes(composition), appDirectory);
  await new Generator({ config, root: appDirectory }).run();
}

const roots: string[] = [];
function writeConfig(
  directory: string,
  overrides: Record<string, string[]> = {},
) {
  writeFileSync(
    resolve(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          ...Object.fromEntries(
            [
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
            ].map((name) => [
              `@composition/${name}`,
              ["./src/arbitrary-name.tsx"],
            ]),
          ),
          "@composition/routes": ["./src/routeTree.gen.ts"],
          ...overrides,
        },
      },
    }),
  );
}
function fixture(): AppComposition {
  const directory = mkdtempSync(resolve(tmpdir(), "application-composition-"));
  roots.push(directory);
  mkdirSync(resolve(directory, "src"));
  writeFileSync(
    resolve(directory, "src/arbitrary-name.tsx"),
    "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/example')({});",
  );
  writeConfig(directory);
  return {
    directory,
    serverEntries: undefined,
    routes: {
      signedIn: [
        {
          type: "route",
          path: "example",
          file: resolve(directory, "src/arbitrary-name.tsx"),
        },
      ],
    },
  };
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

it("keeps URLs and parent guards when a registered source file moves", async () => {
  const composition = fixture();
  await generateRoutes(composition);
  let tree = readFileSync(
    resolve(composition.directory, "src/routeTree.gen.ts"),
    "utf8",
  );
  expect(tree).toContain("fullPath: '/example'");
  expect(tree).toContain("parentRoute: typeof routesWelcome_signedInRoute");
  const moved = resolve(composition.directory, "src/renamed.tsx");
  renameSync(composition.routes.signedIn![0].file, moved);
  composition.routes.signedIn![0].file = moved;
  writeConfig(
    composition.directory,
    Object.fromEntries(
      [
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
      ].map((name) => [`@composition/${name}`, ["./src/renamed.tsx"]]),
    ),
  );
  await generateRoutes(composition);
  tree = readFileSync(
    resolve(composition.directory, "src/routeTree.gen.ts"),
    "utf8",
  );
  expect(tree).toContain("fullPath: '/example'");
  expect(tree).toContain("./renamed");
  expect(tree).not.toContain("./arbitrary-name");
});
it("uses TypeScript's inherited baseUrl and accepts JSONC", () => {
  const composition = fixture();
  const configFile = resolve(composition.directory, "tsconfig.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.extends = "./base.json";
  for (const targets of Object.values(
    config.compilerOptions.paths,
  ) as string[][])
    targets[0] = targets[0].replace("./src/", "./");
  writeFileSync(
    resolve(composition.directory, "base.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: "./src" },
    }),
  );
  writeFileSync(
    configFile,
    `// Application-owned module mappings\n${JSON.stringify(config)}`,
  );
  expect(appAliases(composition)).toContainEqual({
    find: "@composition/server",
    replacement: resolve(composition.directory, "src/arbitrary-name.tsx"),
  });
});

it.each([
  { "@composition/storage": [] },
  { "@composition/identity": [] },
  { "@composition/server": [] },
  { "@composition/server": ["./src/arbitrary-name.tsx", "./src/fallback.tsx"] },
  { "@composition/server": ["./src/*"] },
  { "@composition/unknown": ["./src/arbitrary-name.tsx"] },
])("rejects ambiguous or unsupported composition mappings: %j", (overrides) => {
  const composition = fixture();
  writeConfig(composition.directory, overrides);
  expect(() => appAliases(composition)).toThrow();
});
it("rejects duplicate route registration", () => {
  const composition = fixture();
  composition.routes.signedIn!.push(composition.routes.signedIn![0]);
  expect(() => appRoutes(composition)).toThrow(/Duplicate registered route/);
});

it("rejects registered files from another package", () => {
  const composition = fixture();
  const foreign = resolve(appDirectory, "src/product/client.ts");
  composition.routes.signedIn![0].file = foreign;
  expect(() => appRoutes(composition)).toThrow(/must belong/);
  writeConfig(composition.directory, { "@composition/server": [foreign] });
  expect(() => appAliases(composition)).toThrow(/must belong/);
});
