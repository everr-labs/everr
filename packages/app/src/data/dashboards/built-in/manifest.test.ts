import { describe, expect, it } from "vitest";
import { BUILTIN_DASHBOARDS } from "./catalog";
import { BUILTIN_MANIFEST } from "./manifest";

describe("built-in manifest", () => {
  // The manifest exists so the command bar can list built-ins without
  // bundling the catalog; this equality check is what makes that duplication
  // safe. Adding, renaming, or removing a built-in must touch both files.
  it("matches the catalog exactly, in order", () => {
    expect(BUILTIN_MANIFEST).toEqual(
      BUILTIN_DASHBOARDS.map(({ id, name }) => ({ id, name })),
    );
  });
});
