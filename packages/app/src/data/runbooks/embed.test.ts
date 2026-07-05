import { describe, expect, it } from "vite-plus/test";
import { extractPanelFences, parsePanelEmbed } from "./embed";

describe("parsePanelEmbed", () => {
  it("parses an inline panel with optional height", () => {
    const embed = parsePanelEmbed(
      [
        "kind: Panel",
        "height: 420",
        "spec:",
        "  plugin: { kind: TimeSeriesChart, spec: { unit: req } }",
      ].join("\n"),
    );
    expect(embed).toMatchObject({
      kind: "inline",
      height: 420,
      panel: { kind: "Panel", spec: { plugin: { kind: "TimeSeriesChart" } } },
    });
  });

  it("parses a ref embed", () => {
    expect(parsePanelEmbed("ref: error-rate")).toEqual({
      kind: "ref",
      ref: "error-rate",
      height: undefined,
    });
  });

  it("rejects a block that has both ref and an inline panel", () => {
    expect(() => parsePanelEmbed("ref: shared\nkind: Panel\nspec: {}")).toThrow(
      /both "ref" and "kind: Panel"/,
    );
  });

  it("rejects invalid YAML with a parse message", () => {
    expect(() => parsePanelEmbed("kind: [unclosed")).toThrow(/YAML/i);
  });

  it("rejects an unrecognized shape", () => {
    expect(() => parsePanelEmbed("foo: bar")).toThrow(/panel block/i);
  });

  it("rejects an inline panel that fails the panel schema", () => {
    expect(() => parsePanelEmbed("kind: Panel\nspec: {}")).toThrow(/invalid inline panel/);
  });
});

describe("extractPanelFences", () => {
  it("extracts panel fences and ignores other code blocks", () => {
    const md = [
      "# Title",
      "",
      "```sql",
      "SELECT 1",
      "```",
      "",
      "```panel",
      "ref: a",
      "```",
      "",
      "```panel",
      "ref: b",
      "```",
    ].join("\n");
    const fences = extractPanelFences(md);
    expect(fences.map((f) => f.yaml)).toEqual(["ref: a", "ref: b"]);
  });

  it("returns empty for markdown without fences", () => {
    expect(extractPanelFences("just text")).toEqual([]);
  });

  it("extracts fences from CRLF markdown", () => {
    const md = "intro\r\n```panel\r\nref: a\r\n```\r\n";
    expect(extractPanelFences(md).map((f) => f.yaml)).toEqual(["ref: a"]);
  });

  // CommonMark allows the opening fence to be indented up to three spaces, and
  // react-markdown renders such a block as a panel. The extractor must see it
  // too, or an indented invalid panel passes apply and only fails at render.
  it("extracts an indented fence (matches the renderer)", () => {
    const md = ["text", "   ```panel", "   ref: a", "   ```", ""].join("\n");
    expect(extractPanelFences(md).map((f) => f.yaml)).toEqual(["ref: a"]);
  });

  it("extracts a tilde-delimited fence", () => {
    const md = ["~~~panel", "ref: a", "~~~"].join("\n");
    expect(extractPanelFences(md).map((f) => f.yaml)).toEqual(["ref: a"]);
  });

  it("extracts a panel fence nested in a blockquote", () => {
    const md = ["> note", ">", "> ```panel", "> ref: a", "> ```"].join("\n");
    expect(extractPanelFences(md).map((f) => f.yaml)).toEqual(["ref: a"]);
  });

  it("treats a `panel` info string with trailing meta as a panel", () => {
    const md = ["```panel title", "ref: a", "```"].join("\n");
    expect(extractPanelFences(md).map((f) => f.yaml)).toEqual(["ref: a"]);
  });
});
