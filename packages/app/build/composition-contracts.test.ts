// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateContractSource } from "./check-composition-contracts";

describe("composition contract source validation", () => {
  it("accepts type declarations and type-only imports and exports", () => {
    const source = `
      import type DefaultType from "./default-type";
      import type * as Types from "./types";
      import { type Imported, type AlsoImported as Alias } from "./shared";
      export type { PublicType, Imported } from "./shared";
      export { type Imported as ReExported } from "./shared";
      export interface Contract { value: DefaultType; nested: Types.Nested; }
      export type Shape = Contract & Alias;
    `;

    expect(validateContractSource(source, "contract.ts")).toEqual([]);
  });

  it.each([
    { source: 'import "./register";', label: "bare side-effect import" },
    {
      source: 'import { createThing } from "./runtime";',
      label: "runtime import",
    },
    {
      source: 'import { type Contract, createThing } from "./mixed";',
      label: "mixed import",
    },
    {
      source: 'export { createThing } from "./runtime";',
      label: "runtime re-export",
    },
    { source: 'export * from "./runtime";', label: "export star" },
    { source: "export const value = 1;", label: "runtime export declaration" },
    { source: "export enum Kind { Value }", label: "enum declaration" },
    { source: "export class Runtime {}", label: "class declaration" },
    { source: "const value = 1;", label: "runtime declaration" },
    { source: 'console.log("runtime");', label: "runtime statement" },
    { source: "export = value;", label: "export assignment" },
    {
      source: 'import Runtime = require("./runtime");',
      label: "import equals",
    },
  ])("rejects $label", ({ source }) => {
    expect(validateContractSource(source, "contract.ts")).toHaveLength(1);
  });
});
