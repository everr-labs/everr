import { describe, expect, it } from "vitest";
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

  it("parses a dashboard embed", () => {
    expect(
      parsePanelEmbed("dashboard: demo/web-http-overview\npanel: request-rate"),
    ).toEqual({
      kind: "dashboard",
      project: "demo",
      slug: "web-http-overview",
      panel: "request-rate",
      height: undefined,
    });
  });

  it("rejects a dashboard reference that is not project/slug", () => {
    expect(() => parsePanelEmbed("dashboard: nope\npanel: p")).toThrow(
      /project\/slug/,
    );
  });

  it("rejects invalid YAML with a parse message", () => {
    expect(() => parsePanelEmbed("kind: [unclosed")).toThrow(/YAML/i);
  });

  it("rejects an unrecognized shape", () => {
    expect(() => parsePanelEmbed("foo: bar")).toThrow(/panel block/i);
  });

  it("rejects an inline panel that fails the panel schema", () => {
    expect(() => parsePanelEmbed("kind: Panel\nspec: {}")).toThrow();
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
      "dashboard: demo/x",
      "panel: y",
      "```",
    ].join("\n");
    const fences = extractPanelFences(md);
    expect(fences.map((f) => f.yaml)).toEqual([
      "ref: a",
      "dashboard: demo/x\npanel: y",
    ]);
  });

  it("returns empty for markdown without fences", () => {
    expect(extractPanelFences("just text")).toEqual([]);
  });
});
