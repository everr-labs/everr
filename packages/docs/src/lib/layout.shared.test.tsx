import { describe, expect, it } from "vitest";
import { baseOptions, docsOptions } from "./layout.shared";

describe("layout options", () => {
  it("keeps repeated chrome out of the nested docs sidebar", () => {
    const docs = docsOptions();
    const docsNavTitle = docs.slots?.navTitle;

    expect(baseOptions().nav?.title).toBeTruthy();
    expect(baseOptions().searchToggle?.enabled).not.toBe(false);
    expect(docs.nav?.title).toBeTruthy();
    // The links are shared with the top nav, so what keeps them out of the
    // sidebar is `on: "nav"` on every one of them, not their absence from the
    // list. A link that loses that flag renders in both places.
    expect(docs.links?.length).toBeGreaterThan(0);
    expect(docs.links?.filter((l) => l.on !== "nav")).toEqual([]);
    expect(docs.githubUrl).toBeUndefined();
    expect(docsNavTitle?.({ href: "/" })).toBeNull();
    expect(docs.searchToggle?.enabled).toBe(false);
    expect(docs.sidebar?.collapsible).toBe(false);
  });

  it("offsets the docs layout below the shared top navigation", () => {
    expect(docsOptions().containerProps?.style).toMatchObject({
      "--fd-banner-height": "3.5rem",
    });
  });
});
