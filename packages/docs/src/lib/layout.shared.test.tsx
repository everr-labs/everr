import { describe, expect, it } from "vite-plus/test";
import { baseOptions, docsOptions } from "./layout.shared";

describe("layout options", () => {
  it("keeps repeated chrome out of the nested docs sidebar", () => {
    const docs = docsOptions();
    const docsNavTitle = docs.slots?.navTitle;

    expect(baseOptions().nav?.title).toBeTruthy();
    expect(baseOptions().searchToggle?.enabled).not.toBe(false);
    expect(docs.nav?.title).toBeTruthy();
    expect(docs.links).not.toContainEqual(expect.objectContaining({ text: "Docs" }));
    expect(docs.links).not.toContainEqual(expect.objectContaining({ text: "Discord" }));
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
