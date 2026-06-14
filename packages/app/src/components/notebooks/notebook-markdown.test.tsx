import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Render TanStack's <Link> as a plain anchor that surfaces its props, so we can
// assert what NotebookAnchor forwards (to, hash, and spread attrs like title).
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    hash,
    children,
    ...rest
  }: {
    to: string;
    params?: { _splat?: string };
    hash?: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a
      data-link="internal"
      data-to={to}
      data-splat={params?._splat ?? ""}
      data-hash={hash ?? ""}
      {...rest}
    >
      {children}
    </a>
  ),
}));

// Stub the panel embed (pulls in DB-backed dashboard code); this suite only
// exercises anchor rendering.
vi.mock("./notebook-panel-embed", () => ({ PanelEmbedBlock: () => null }));

import { NotebookMarkdown } from "./notebook-markdown";

// Mirror the real resolver: strip any #fragment/?query before matching a page.
const resolveLink = (href: string) =>
  href.replace(/[#?].*$/, "") === "./traffic.md" ? "traffic" : null;

function renderNotebook(markdown: string) {
  return render(
    <NotebookMarkdown
      markdown={markdown}
      project="demo"
      slug="rb"
      resolveLink={resolveLink}
    />,
  );
}

describe("NotebookMarkdown anchors", () => {
  it("opens external links in a new tab with a safe rel and keeps the title", () => {
    const { container } = renderNotebook('[ext](https://example.com "Ext")');
    const a = container.querySelector(
      "a:not([data-link])",
    ) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe("Ext");
  });

  it("renders a resolved in-notebook link as a router Link and forwards the title", () => {
    const { container } = renderNotebook('[Traffic](./traffic.md "Go")');
    const link = container.querySelector('[data-link="internal"]');
    expect(link?.getAttribute("data-to")).toBe("/notebooks/$project/$slug/$");
    expect(link?.getAttribute("data-splat")).toBe("traffic");
    // title from `[text](url "title")` must survive on internal links too.
    expect(link?.getAttribute("title")).toBe("Go");
  });

  it("keeps the fragment on a resolved internal link", () => {
    const { container } = renderNotebook("[Errors](./traffic.md#errors)");
    const link = container.querySelector('[data-link="internal"]');
    expect(link?.getAttribute("data-hash")).toBe("errors");
  });

  it("leaves hash-only links as in-place anchors (no new tab)", () => {
    const { container } = renderNotebook("[Top](#section)");
    const a = container.querySelector(
      "a:not([data-link])",
    ) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("#section");
    expect(a.getAttribute("target")).toBeNull();
  });

  it("does not leak react-markdown's `node` prop onto the DOM", () => {
    const { container } = renderNotebook("[ext](https://example.com)");
    const a = container.querySelector(
      "a:not([data-link])",
    ) as HTMLAnchorElement;
    expect(a.getAttribute("node")).toBeNull();
  });
});
