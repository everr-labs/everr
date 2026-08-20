import { cn } from "@everr/ui/lib/utils";
import { type RefObject, useEffect, useState } from "react";
import {
  FloatingMarginNav,
  floatingLinkActiveClass,
  floatingLinkClass,
} from "./floating-margin-nav";

interface Heading {
  id: string;
  text: string;
  /** 2 or 3: deeper headings would make the list longer than it is useful. */
  level: number;
}

/**
 * Read the rendered headings rather than re-parsing the markdown: the ids come
 * from `rehype-slug` at render time, and reading them back is the only way the
 * list and the anchors can never disagree.
 */
function useHeadings(container: RefObject<HTMLElement | null>): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    setHeadings(
      [...root.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map((el) => ({
        id: el.id,
        text: el.textContent ?? "",
        level: el.tagName === "H2" ? 2 : 3,
      })),
    );
  }, [container]);
  return headings;
}

/** How far into the viewport a heading must climb to count as the one being read. */
const HEADING_BAND = 140;

/**
 * The heading the reader has most recently passed. Measured rather than
 * observed: at the top of a page nothing has been passed yet, and at the
 * bottom every heading has, and an intersection test answers neither.
 */
function useActiveHeading(
  headings: Heading[],
  container: RefObject<HTMLElement | null>,
): string | undefined {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    if (headings.length === 0) return;
    // Scoped to the prose: `rehype-slug` only makes ids unique within the page
    // it rendered, so a document-wide lookup could measure the app shell.
    const root = container.current;
    // The pane declares itself with the same marker the router resets on
    // (see `scrollToTopSelectors`), so this asks the layer that owns the
    // scrolling rather than sniffing overflow up the tree.
    const scroller = container.current?.closest<HTMLElement>(
      "[data-scroll-to-top]",
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = headings[0]?.id;
      // Headings are in document order, so the first one still below the band
      // ends the search.
      for (const heading of headings) {
        const el = root?.querySelector(`[id="${CSS.escape(heading.id)}"]`);
        if (!el || el.getBoundingClientRect().top > HEADING_BAND) break;
        current = heading.id;
      }
      // The last sections can be too short to ever reach the band. At the
      // bottom of the runbook the reader is at the end of it, whatever the
      // measurements say.
      const atBottom =
        scroller != null &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) current = headings[headings.length - 1]?.id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings, container]);
  return active;
}

/**
 * The headings of the page being read, floating in the margin right of the
 * reading column: the mirror of the pages nav on the left. Give it a `key`
 * that changes with the page, so it re-reads the headings on arrival.
 */
export function RunbookToc({
  container,
}: {
  container: RefObject<HTMLElement | null>;
}) {
  const headings = useHeadings(container);
  const active = useActiveHeading(headings, container);

  // One heading is the page title over again, not a table of contents.
  if (headings.length < 2) return null;

  return (
    <FloatingMarginNav side="right" label="On this page">
      {headings.map((heading) => (
        <a
          key={heading.id}
          href={`#${heading.id}`}
          aria-current={heading.id === active ? "true" : undefined}
          className={cn(
            floatingLinkClass,
            "block pr-2",
            // Headings wrap rather than being cut: half a heading is not a
            // heading, and this list is the only place they are all visible.
            heading.level === 3 ? "pl-5" : "pl-2",
            heading.id === active && floatingLinkActiveClass,
          )}
        >
          {heading.text}
        </a>
      ))}
    </FloatingMarginNav>
  );
}
