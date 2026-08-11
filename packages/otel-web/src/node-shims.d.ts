// Small global declarations for the tests that operate in the Node
// environment. The tsconfig of this browser library has no @types/node, and
// this is correct, because @types/node changes the global types of the full
// package. The browser-graph.test.ts file needs only these functions.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}

// The build flag of the environment. The SDK reads it at the sites that only a
// development build needs, and every bundler replaces the expression. Thus a
// production build removes those branches, their strings, and the state behind
// them. This declaration gives only the one field that the package reads,
// because @types/node changes the global types of the full package.
declare const process: { env: { NODE_ENV?: string } };
