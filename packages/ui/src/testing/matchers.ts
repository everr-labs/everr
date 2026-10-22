import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import "vite-plus/test";

declare module "vitest" {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
}
