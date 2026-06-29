import { describe, expect, it } from "vitest";
import { buildDesiredRunbookSet } from "./desired";

const doc = (over: Record<string, unknown> = {}) => ({
  kind: "Runbook",
  metadata: { name: "rb", project: "demo" },
  spec: { markdown: { inline: "# Hi" } },
  ...over,
});

describe("buildDesiredRunbookSet", () => {
  it("builds a desired resource with project, slug and folderPath", () => {
    const out = buildDesiredRunbookSet([
      { path: "runbooks/rb.yaml", document: doc() },
    ]);
    expect(out).toEqual([
      {
        project: "demo",
        slug: "rb",
        folderPath: "runbooks",
        document: doc(),
      },
    ]);
  });

  it("slug falls back to the filename", () => {
    const d = doc({ metadata: { project: "demo" } });
    const out = buildDesiredRunbookSet([
      { path: "incidents.yaml", document: d },
    ]);
    expect(out[0]?.slug).toBe("incidents");
  });

  it("rejects duplicate (project, slug)", () => {
    expect(() =>
      buildDesiredRunbookSet([
        { path: "a.yaml", document: doc() },
        { path: "b/rb.yaml", document: doc() },
      ]),
    ).toThrow(/duplicate runbook/);
  });

  it("rejects an invalid spec naming the file", () => {
    expect(() =>
      buildDesiredRunbookSet([
        { path: "bad.yaml", document: doc({ spec: {} }) },
      ]),
    ).toThrow(/bad\.yaml/);
  });

  it("rejects an unresolved markdown file pointer", () => {
    expect(() =>
      buildDesiredRunbookSet([
        {
          path: "bad.yaml",
          document: doc({ spec: { markdown: { file: "./x.md" } } }),
        },
      ]),
    ).toThrow(/everr CLI/);
  });

  it("rejects a malformed panel fence in markdown", () => {
    const d = doc({
      spec: { markdown: { inline: "```panel\nfoo: bar\n```" } },
    });
    expect(() =>
      buildDesiredRunbookSet([{ path: "rb.yaml", document: d }]),
    ).toThrow(/panel block/);
  });

  it("rejects a ref fence pointing at a missing shared panel", () => {
    const d = doc({
      spec: { markdown: { inline: "```panel\nref: nope\n```" } },
    });
    expect(() =>
      buildDesiredRunbookSet([{ path: "rb.yaml", document: d }]),
    ).toThrow(/unknown panel "nope"/);
  });

  it("rejects an inline fence panel with an invalid plugin option", () => {
    const md = [
      "```panel",
      "kind: Panel",
      "spec:",
      "  plugin: { kind: TimeSeriesChart, spec: { unit: 42 } }",
      "```",
    ].join("\n");
    const d = doc({ spec: { markdown: { inline: md } } });
    expect(() =>
      buildDesiredRunbookSet([{ path: "rb.yaml", document: d }]),
    ).toThrow(/rb\.yaml/);
  });

  it("validates fences in nested pages", () => {
    const d = doc({
      spec: {
        markdown: { inline: "# ok" },
        pages: [
          {
            name: "triage",
            markdown: { inline: "ok" },
            pages: [
              {
                name: "net",
                markdown: { inline: "```panel\nref: nope\n```" },
              },
            ],
          },
        ],
      },
    });
    expect(() =>
      buildDesiredRunbookSet([{ path: "rb.yaml", document: d }]),
    ).toThrow(/triage\/net/);
  });

  it("accepts valid fences of both forms", () => {
    const md = [
      "```panel",
      "kind: Panel",
      "spec:",
      "  plugin: { kind: TimeSeriesChart, spec: { unit: req } }",
      "```",
      "```panel",
      "ref: shared",
      "```",
    ].join("\n");
    const d = doc({
      spec: {
        markdown: { inline: md },
        panels: {
          shared: {
            kind: "Panel",
            spec: { plugin: { kind: "Table", spec: {} } },
          },
        },
      },
    });
    expect(
      buildDesiredRunbookSet([{ path: "rb.yaml", document: d }]),
    ).toHaveLength(1);
  });
});
