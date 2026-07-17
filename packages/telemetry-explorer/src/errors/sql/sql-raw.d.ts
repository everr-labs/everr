// Vite/Vitest `?raw` imports: load a file's contents as a string. Used by the
// fingerprint drift test to read the canonical .sql fragments the Rust CLI
// also includes.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
