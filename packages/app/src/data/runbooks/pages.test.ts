import { describe, expect, it } from "vite-plus/test";
import {
  buildFileToPageMap,
  findPage,
  hrefHash,
  makeRunbookLinkResolver,
  pageNavTree,
  toDashboardDocument,
} from "./pages";
import type { RunbookSpec } from "./schema";

const spec: RunbookSpec = {
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

// Post-CLI spec: pages carry both `inline` contents and the original `file`.
const fileSpec: RunbookSpec = {
  markdown: { inline: "# Index", file: "./book/index.md" },
  pages: [
    {
      name: "traffic",
      markdown: { inline: "# Traffic", file: "./book/traffic.md" },
    },
    {
      name: "timeline",
      markdown: { inline: "# Timeline", file: "./book/timeline.md" },
      pages: [
        {
          name: "deploys",
          markdown: {
            inline: "# Deploys",
            file: "./book/timeline-deploys.md",
          },
        },
      ],
    },
    // inline-only page: no file → absent from the file map.
    { name: "rollback", markdown: { inline: "# Roll" } },
  ],
};

describe("findPage file", () => {
  it("returns file for the index page", () => {
    expect(findPage(fileSpec, "")?.file).toBe("./book/index.md");
  });

  it("returns file for nested pages", () => {
    expect(findPage(fileSpec, "timeline/deploys")?.file).toBe("./book/timeline-deploys.md");
  });

  it("omits file for inline-only pages", () => {
    expect(findPage(fileSpec, "rollback")?.file).toBeUndefined();
  });
});

describe("buildFileToPageMap", () => {
  it("maps normalized file paths to page paths, index included", () => {
    expect(buildFileToPageMap(fileSpec)).toEqual(
      new Map([
        ["book/index.md", ""],
        ["book/traffic.md", "traffic"],
        ["book/timeline.md", "timeline"],
        ["book/timeline-deploys.md", "timeline/deploys"],
      ]),
    );
  });
});

describe("makeRunbookLinkResolver", () => {
  const resolve = makeRunbookLinkResolver(fileSpec);

  it.each([
    // External, app-absolute and hash-only links aren't runbook pages.
    ["https://x", undefined, "", null],
    ["mailto:a@b", undefined, "", null],
    ["#anchor", undefined, "", null],
    ["/dashboards/x", undefined, "", null],
    // A page path, from the top of the runbook, ignoring fragment and query.
    ["timeline/deploys", undefined, "", "timeline/deploys"],
    ["traffic#section", undefined, "", "traffic"],
    ["traffic?x=1", undefined, "", "traffic"],
    ["unknown", undefined, "", null],
    // A markdown file, relative to the current page's file.
    ["./traffic.md", "./book/index.md", "", "traffic"],
    ["./timeline-deploys.md", "./book/timeline.md", "timeline", "timeline/deploys"],
    ["../index.md", "./book/sub/page.md", "", ""],
    ["traffic.md", undefined, "", null],
    // Relative to the current page, read as a folder of its child pages.
    ["..", undefined, "timeline/deploys", "timeline"],
    ["../..", undefined, "timeline/deploys", ""],
    [".", undefined, "timeline/deploys", "timeline/deploys"],
    ["../../traffic#errors", undefined, "timeline/deploys", "traffic"],
    ["./deploys", undefined, "timeline", "timeline/deploys"],
    ["../rollback", undefined, "traffic", "rollback"],
    ["..", undefined, "", null],
    ["../missing", undefined, "timeline/deploys", null],
  ])("resolves %s (file %s, page %o) to %o", (href, file, page, expected) => {
    expect(resolve(href, file, page)).toBe(expected);
  });
});

describe("hrefHash", () => {
  it("returns the fragment without the leading #", () => {
    expect(hrefHash("./traffic.md#errors")).toBe("errors");
    expect(hrefHash("traffic#section")).toBe("section");
  });

  it("reads the fragment after a query string", () => {
    expect(hrefHash("traffic.md?x=1#errors")).toBe("errors");
  });

  it("returns undefined with no fragment or an empty one", () => {
    expect(hrefHash("./traffic.md")).toBeUndefined();
    expect(hrefHash("traffic?x=1")).toBeUndefined();
    expect(hrefHash("traffic#")).toBeUndefined();
  });
});

describe("toDashboardDocument", () => {
  it("adapts a runbook into a Dashboard-shaped document for the panel machinery", () => {
    const doc = toDashboardDocument(
      { kind: "Runbook", metadata: { name: "rb", project: "demo" }, spec },
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
    const withVars: RunbookSpec = {
      ...spec,
      variables: [{ kind: "TextVariable", spec: { name: "svc", value: "api" } }],
      panels: {
        p: { kind: "Panel", spec: { plugin: { kind: "Table", spec: {} } } },
      },
    };
    const doc = toDashboardDocument(
      { kind: "Runbook", metadata: { name: "rb" }, spec: withVars },
      "demo",
      "rb",
    );
    expect(doc.spec.variables).toHaveLength(1);
    expect(Object.keys(doc.spec.panels)).toEqual(["p"]);
  });

  it("adapts a runbook duration to the dashboard time range", () => {
    const doc = toDashboardDocument(
      {
        kind: "Runbook",
        metadata: { name: "rb" },
        spec: { ...spec, duration: "6h" },
      },
      "demo",
      "rb",
    );

    expect(doc.spec.timeRange).toEqual({ from: "now-6h", to: "now" });
  });
});
