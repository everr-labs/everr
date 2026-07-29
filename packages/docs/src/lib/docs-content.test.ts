import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const docsRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../content/docs",
);

describe("docs content", () => {
  it("removes app, features, and the reference index while keeping reference subpages", () => {
    const meta = JSON.parse(
      readFileSync(join(docsRoot, "meta.json"), "utf8"),
    ) as { pages: string[] };
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
    expect(referenceMeta.pages).toEqual(
      expect.arrayContaining(["cli", "skills", "datemath", "retention"]),
    );
  });

  // The listing and the tree drift apart in both directions: a page renamed or
  // moved leaves a dangling entry (a sidebar link to nothing), and a page added
  // without a listing entry is unreachable from the sidebar. Neither shows up in
  // a typecheck or a build, so assert it here rather than pinning an exact page
  // order, which only records today's sidebar and fails on every reshuffle.
  it("keeps every meta.json listing in step with the files beside it", () => {
    // A directory is a docs section only if it holds pages. Anything else under
    // content/docs is local tooling state (hook caches and the like), which is
    // untracked and must not read as an orphaned section.
    const isSection = (dir: string) =>
      existsSync(join(dir, "meta.json")) ||
      readdirSync(dir).some((n) => n.endsWith(".mdx"));

    const sections = readdirSync(docsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((name) => isSection(join(docsRoot, name)));

    for (const section of [".", ...sections]) {
      const dir = join(docsRoot, section);
      const metaPath = join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;
      const { pages } = JSON.parse(readFileSync(metaPath, "utf8")) as {
        pages: string[];
      };

      const onDisk = readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) =>
            !e.name.startsWith(".") &&
            (e.isDirectory()
              ? isSection(join(dir, e.name))
              : e.name.endsWith(".mdx")),
        )
        .map((e) => e.name.replace(/\.mdx$/, ""))
        .filter((name) => name !== "index");

      // Separators ("---Title---") and external links are listing-only. `index`
      // is the section's own landing page: listing it is optional, so it is not
      // evidence either way.
      const listed = pages.filter(
        (p) => !p.startsWith("---") && !p.includes("/") && p !== "index",
      );

      expect(
        listed.filter((p) => !onDisk.includes(p)),
        `${section}/meta.json lists pages that do not exist`,
      ).toEqual([]);
      expect(
        onDisk.filter((p) => !listed.includes(p)),
        `${section} has pages missing from its meta.json`,
      ).toEqual([]);
    }
  });
});
