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
import { appDirectory, appRoutes, type AppComposition } from "../vite.app";

async function generateRoutes(composition: AppComposition) {
  const config = getConfig(appRoutes(composition), appDirectory);
  await new Generator({ config, root: appDirectory }).run();
}

const roots: string[] = [];
function writeConfig(
  directory: string,
  modulePath = "./src/arbitrary-name.tsx",
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
              "runtime",
              "entry",
              "deployment",
              "client",
              "product",
              "navigation",
              "dashboards",
              "ui",
              "pages",
              "layouts",
            ].map((name) => [`@composition/${name}`, [modulePath]]),
          ),
          "@composition/routes": ["./src/routeTree.gen.ts"],
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
  writeConfig(composition.directory, "./src/renamed.tsx");
  await generateRoutes(composition);
  tree = readFileSync(
    resolve(composition.directory, "src/routeTree.gen.ts"),
    "utf8",
  );
  expect(tree).toContain("fullPath: '/example'");
  expect(tree).toContain("parentRoute: typeof routesWelcome_signedInRoute");
  expect(tree).toContain("./renamed");
  expect(tree).not.toContain("./arbitrary-name");
});
