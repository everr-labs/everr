import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "../../content/docs");

describe("docs content", () => {
  it("removes app, features, and the reference index while keeping reference subpages", () => {
    const meta = JSON.parse(readFileSync(join(docsRoot, "meta.json"), "utf8")) as {
      pages: string[];
    };
    const index = readFileSync(join(docsRoot, "index.mdx"), "utf8");
    const referenceMeta = JSON.parse(
      readFileSync(join(docsRoot, "reference/meta.json"), "utf8"),
    ) as { pages: string[] };

    expect(meta.pages).not.toContain("app");
    expect(meta.pages).not.toContain("features");
    expect(meta.pages).toContain("reference");

    expect(index).not.toContain("/docs/app");
    expect(index).not.toContain("/docs/features");
    expect(index).not.toMatch(/href="\/docs\/reference"/);

    expect(existsSync(join(docsRoot, "app"))).toBe(false);
    expect(existsSync(join(docsRoot, "features"))).toBe(false);
    expect(existsSync(join(docsRoot, "reference/index.mdx"))).toBe(false);
    expect(existsSync(join(docsRoot, "reference/cli.mdx"))).toBe(true);
    expect(existsSync(join(docsRoot, "reference/skills.mdx"))).toBe(true);
    expect(existsSync(join(docsRoot, "reference/datemath.mdx"))).toBe(true);
    expect(existsSync(join(docsRoot, "reference/retention.mdx"))).toBe(true);
    expect(referenceMeta.pages).toEqual(["cli", "skills", "datemath", "retention"]);
  });
});
