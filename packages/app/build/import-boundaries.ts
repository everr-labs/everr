import { readFileSync, readdirSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

function inside(directory: string, file: string) {
  const path = relative(directory, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Package exports are the only supported way to cross source-package boundaries. */
export function checkSourceImports(
  directory: string,
  file: string,
  source: string,
  localAlias: string,
) {
  const syntax = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const require = createRequire(file);
  const errors: string[] = [];
  const check = (specifier: string) => {
    if (specifier.startsWith("@composition/")) {
      if (!/^@composition\/[a-z]+$/.test(specifier))
        errors.push(
          `${specifier}: composition modules cannot be used as directory aliases`,
        );
      return;
    }
    if (specifier.startsWith("@/")) {
      if (!inside(directory, resolve(localAlias, specifier.slice(2))))
        errors.push(
          `${specifier}: the @/ alias is private to its owning package; use a package export`,
        );
      return;
    }
    // Documentation assets are not source-module imports.
    if (specifier.endsWith(".md?raw")) return;
    if (specifier.startsWith(".") || isAbsolute(specifier)) {
      const target = resolve(file, "..", specifier);
      if (
        !inside(directory, target) ||
        target.split(sep).includes("node_modules")
      )
        errors.push(
          `${specifier}: relative imports must stay inside the package`,
        );
      return;
    }
    if (specifier.startsWith("node:") || builtinModules.includes(specifier))
      return;
    if (!specifier.startsWith("@everr/")) return;
    // Resolve package exports using Node's export-map enforcement, including mocks.
    try {
      require.resolve(specifier);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
        errors.push(`${specifier}: not a public package export`);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const name = node.expression.getText(syntax);
      if (
        [
          "import",
          "require",
          "vi.mock",
          "vi.doMock",
          "vi.importActual",
          "vi.importMock",
        ].includes(name)
      )
        check(node.arguments[0].text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      check(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  if (errors.length)
    throw new Error(`${relative(directory, file)}\n${errors.join("\n")}`);
}

export function checkPackageImports(directory: string, localAlias: string) {
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = resolve(folder, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          !["node_modules", "dist", "coverage"].includes(entry.name)
        )
          walk(file);
      } else if (
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        entry.name !== "routeTree.gen.ts"
      ) {
        checkSourceImports(
          directory,
          file,
          readFileSync(file, "utf8"),
          localAlias,
        );
      }
    }
  };
  walk(directory);
}
