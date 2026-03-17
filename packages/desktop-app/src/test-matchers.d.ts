import "vitest";
import type matchers from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<T = any> extends matchers.TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends matchers.TestingLibraryMatchers<any, any> {}
}
