import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Oxlint enforces package boundaries across import syntaxes without general lint rules", () => {
  const directories = ["app", "cloud"].map((name) =>
    mkdtempSync(resolve(root, `packages/${name}/boundary-fixtures-`)),
  );
  const expected = new Map();
  const add = (directory, name, source, forbidden) => {
    const file = resolve(directory, `${name}.ts`);
    writeFileSync(file, source);
    expected.set(relative(root, file), forbidden);
  };
  try {
    const [app, cloud] = directories;
    const syntaxes = [
      (path) => `import ${path};`,
      (path) => `export * from ${path};`,
      (path) => `import type { T } from ${path};`,
      (path) => `type T = import(${path}).T;`,
      (path) => `import(${path});`,
      (path) => `require(${path});`,
      ...["mock", "doMock", "importActual", "importMock"].map(
        (method) => (path) => `vi.${method}(${path});`,
      ),
    ];
    const forbidden = [
      "../../app/src/product/client",
      "../../app/src/does-not-exist",
      "@everr/app/src/product/client",
      "@everr/app/product/pages",
      "@everr/app/components/users-management/members-page",
      "@/product/client",
      "#app/product/client.ts",
      "#app/../../cloud/private.ts",
      "@composition/ui/private",
      "@composition/ui/../../private",
      "../node_modules/@everr/app/src/product/client",
      resolve(root, "packages/app/src/product/client.ts"),
    ];
    for (const [syntaxIndex, syntax] of syntaxes.entries()) {
      for (const [pathIndex, path] of forbidden.entries()) {
        add(
          cloud,
          `forbidden-${syntaxIndex}-${pathIndex}`,
          syntax(JSON.stringify(path)),
          true,
        );
      }
      add(
        cloud,
        `public-${syntaxIndex}`,
        syntax('"@everr/app/product/client"'),
        false,
      );
      add(app, `alias-${syntaxIndex}`, syntax('"#app/product/client.ts"'), false);
      add(
        app,
        `traversal-${syntaxIndex}`,
        syntax('"#app/../../cloud/private.ts"'),
        true,
      );
      add(
        app,
        `composition-${syntaxIndex}`,
        syntax('"@composition/ui"'),
        false,
      );
    }
    add(
      app,
      "ordinary",
      'import "../src/product/client"; import "react"; import "node:path"; const unused = 1; debugger;',
      false,
    );
    add(app, "documentation", 'import "../../../docs/schema.md?raw";', false);
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/oxlint/bin/oxlint"),
        "-c",
        ".oxlintrc.json",
        "--format",
        "json",
        ...directories,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.number_of_files, expected.size);
    const rejected = new Set();
    for (const diagnostic of report.diagnostics) {
      assert.equal(diagnostic.code, "boundaries(dependencies)");
      assert.equal(
        expected.get(diagnostic.filename),
        true,
        JSON.stringify(diagnostic),
      );
      rejected.add(diagnostic.filename);
    }
    for (const [file, forbidden] of expected) {
      assert.equal(rejected.has(file), forbidden, file);
    }
  } finally {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
  }
});
