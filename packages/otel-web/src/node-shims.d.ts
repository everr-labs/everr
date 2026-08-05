// Minimal ambient shims for the node-environment tests: this browser-lib
// tsconfig deliberately has no @types/node (it would change global typings
// for the whole package), and browser-graph.test.ts only needs these calls.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}
