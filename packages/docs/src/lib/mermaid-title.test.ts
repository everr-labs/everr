import { describe, expect, it } from "vite-plus/test";
import { mermaidTitle } from "./mermaid-title";

describe("mermaid title", () => {
  it("reads the frontmatter title", () => {
    const chart =
      "---\ntitle: The browser and the server share a name\n---\nflowchart LR\n  A --> B";
    expect(mermaidTitle(chart)).toBe("The browser and the server share a name");
  });

  it("strips quotes around the title", () => {
    expect(mermaidTitle('---\ntitle: "Quoted: title"\n---\nflowchart LR')).toBe("Quoted: title");
  });

  it("returns undefined without a frontmatter title", () => {
    expect(mermaidTitle("flowchart LR\n  A --> B")).toBeUndefined();
    expect(mermaidTitle("---\nconfig:\n  theme: dark\n---\nflowchart LR")).toBeUndefined();
  });

  it("ignores a title line outside the frontmatter", () => {
    expect(mermaidTitle("flowchart LR\n  title: not a title")).toBeUndefined();
  });
});
