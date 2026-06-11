import { describe, expect, it } from "vitest";
import { findPage, pageNavTree, toDashboardDocument } from "./pages";
import type { NotebookSpec } from "./schema";

const spec: NotebookSpec = {
  display: { name: "Runbook" },
  markdown: { inline: "# Index" },
  pages: [
    {
      name: "triage",
      markdown: { inline: "# Triage" },
      pages: [
        {
          name: "network",
          display: { name: "Network" },
          markdown: { inline: "# Net" },
        },
      ],
    },
    { name: "rollback", markdown: { inline: "# Roll" } },
  ],
};

describe("findPage", () => {
  it("empty path returns the index page", () => {
    expect(findPage(spec, "")).toEqual({
      title: "Runbook",
      markdown: "# Index",
    });
  });

  it("resolves nested paths", () => {
    expect(findPage(spec, "triage/network")).toEqual({
      title: "Network",
      markdown: "# Net",
    });
  });

  it("falls back to the page name as title", () => {
    expect(findPage(spec, "triage")?.title).toBe("triage");
  });

  it("returns null for unknown paths", () => {
    expect(findPage(spec, "nope")).toBeNull();
    expect(findPage(spec, "triage/nope")).toBeNull();
  });
});

describe("pageNavTree", () => {
  it("builds nav nodes with joined paths", () => {
    expect(pageNavTree(spec)).toEqual([
      {
        path: "triage",
        title: "triage",
        children: [{ path: "triage/network", title: "Network", children: [] }],
      },
      { path: "rollback", title: "rollback", children: [] },
    ]);
  });
});

describe("toDashboardDocument", () => {
  it("adapts a notebook into a Dashboard-shaped document for the panel machinery", () => {
    const doc = toDashboardDocument(
      { kind: "Notebook", metadata: { name: "rb", project: "demo" }, spec },
      "demo",
      "rb",
    );
    expect(doc.kind).toBe("Dashboard");
    expect(doc.metadata).toEqual({ name: "rb", project: "demo" });
    expect(doc.spec.panels).toEqual({});
    expect(doc.spec.layouts).toEqual([]);
    expect(doc.spec.variables).toBeUndefined();
  });

  it("passes through variables and shared panels", () => {
    const withVars: NotebookSpec = {
      ...spec,
      variables: [
        { kind: "TextVariable", spec: { name: "svc", value: "api" } },
      ],
      panels: {
        p: { kind: "Panel", spec: { plugin: { kind: "Table", spec: {} } } },
      },
    };
    const doc = toDashboardDocument(
      { kind: "Notebook", metadata: { name: "rb" }, spec: withVars },
      "demo",
      "rb",
    );
    expect(doc.spec.variables).toHaveLength(1);
    expect(Object.keys(doc.spec.panels)).toEqual(["p"]);
  });
});
