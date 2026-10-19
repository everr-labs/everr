import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function validateContractSource(source: string, path: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];

  for (const statement of file.statements) {
    const isTypeImport = (node: ts.ImportDeclaration) => {
      const clause = node.importClause;
      return Boolean(
        clause &&
          (clause.isTypeOnly ||
            (!clause.name &&
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.length > 0 &&
              clause.namedBindings.elements.every(
                (element) => element.isTypeOnly,
              ))),
      );
    };
    const isTypeExport = (node: ts.ExportDeclaration) =>
      node.isTypeOnly ||
      (node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly));
    const allowed =
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEmptyStatement(statement) ||
      (ts.isImportDeclaration(statement) && isTypeImport(statement)) ||
      (ts.isExportDeclaration(statement) && isTypeExport(statement));

    if (!allowed) {
      const { line, character } = file.getLineAndCharacterOfPosition(
        statement.getStart(file),
      );
      errors.push(
        `${path}:${line + 1}:${character + 1}: composition contracts may contain only type declarations and type-only imports/exports`,
      );
    }
  }

  return errors;
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function checkCompositionContracts() {
  const directory = resolve(repositoryRoot, "packages/app/src/composition");
  const errors = collectTypeScriptFiles(directory).flatMap((path) =>
    validateContractSource(readFileSync(path, "utf8"), path),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  checkCompositionContracts();
