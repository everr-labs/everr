import { describe, expect, it } from "vitest";
import { baseOptions, docsOptions } from "./layout.shared";

describe("layout options", () => {
  it("keeps repeated chrome out of the nested docs sidebar", () => {
    const docs = docsOptions();
    const docsNavTitle = docs.slots?.navTitle;

    expect(baseOptions().nav?.title).toBeTruthy();
    expect(baseOptions().searchToggle?.enabled).not.toBe(false);
    expect(docs.nav?.title).toBeTruthy();
    expect(docsNavTitle?.({ href: "/" })).toBeNull();
    expect(docs.searchToggle?.enabled).toBe(false);
    expect(docs.sidebar?.collapsible).toBe(false);
  });
});
