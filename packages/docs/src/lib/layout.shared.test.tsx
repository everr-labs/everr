import { describe, expect, it } from "vite-plus/test";
import { docsOptions } from "./layout.shared";

describe("layout options", () => {
  it("keeps repeated chrome out of the nested docs sidebar", () => {
    const docs = docsOptions();
    const docsNavTitle = docs.slots?.navTitle;

    expect(docs.nav?.component).toBeUndefined();
    expect(docs.links).toBeUndefined();
    expect(docs.githubUrl).toBeUndefined();
    expect(docsNavTitle?.({ href: "/" })).toBeNull();
    expect(docs.searchToggle?.enabled).toBe(false);
    expect(docs.sidebar?.collapsible).toBe(false);
  });
});
