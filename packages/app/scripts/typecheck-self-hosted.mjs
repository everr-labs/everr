import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const project = fileURLToPath(new URL("../tsconfig.self-hosted.json", import.meta.url));
const host = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};
const config = ts.readConfigFile(project, ts.sys.readFile);
if (config.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([config.error], host));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(project));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
}
// TypeScript follows imports even into excluded directories. Check its complete
// source graph so a type-only cloud dependency cannot silently re-enter the product.
const forbidden = program.getSourceFiles().map((source) => source.fileName)
  .filter((file) => /\/src\/cloud\//.test(file) || file.includes("@polar-sh/"));
if (forbidden.length) {
  console.error(`Cloud dependencies reached the self-hosted type graph:\n${forbidden.join("\n")}`);
}
if (diagnostics.length || forbidden.length) process.exit(1);
console.log("Self-hosted types pass without cloud or Polar dependencies.");
