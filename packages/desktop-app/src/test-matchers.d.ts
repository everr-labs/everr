import "vite-plus/test";
import type matchers from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // oxlint-disable-next-line typescript/no-explicit-any -- must mirror the `any` in jest-dom's own TestingLibraryMatchers signature to correctly augment the matcher types.
  interface Assertion<T = any> extends matchers.TestingLibraryMatchers<any, T> {}
  // oxlint-disable-next-line typescript/no-explicit-any -- must mirror the `any` in jest-dom's own TestingLibraryMatchers signature to correctly augment the matcher types.
  interface AsymmetricMatchersContaining extends matchers.TestingLibraryMatchers<any, any> {}
}
