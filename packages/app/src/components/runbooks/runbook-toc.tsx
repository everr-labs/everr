import { cn } from "@everr/ui/lib/utils";
import { type RefObject, useEffect, useState } from "react";
import { groupLabelClass } from "@/components/dashboards/dashboard-tree";

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
function useHeadings(
  container: RefObject<HTMLElement | null>,
  pageKey: string,
): Heading[] {
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
  }, [container, pageKey]);
  return headings;
}

/** How far into the viewport a heading must climb to count as the one being read. */
const HEADING_BAND = 140;

/** The element the runbook actually scrolls in, which is not the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

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
    const scroller = scrollParent(container.current);
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = headings[0]?.id;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= HEADING_BAND)
          current = heading.id;
      }
      // The last sections can be too short to ever reach the band. At the
      // bottom of the runbook the reader is at the end of it, whatever the
      // measurements say.
      const atBottom =
        scroller !== null &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) current = headings[headings.length - 1]?.id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // Capture: the runbook scrolls in its own pane, not the window, and scroll
    // events do not bubble out of it.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [headings, container]);
  return active;
}

/**
 * The headings of the page being read, floating in the margin right of the
 * reading column: the mirror of the pages nav on the left, and like it, it
 * takes none of the column's width. Where the pane has no margin to spare the
 * whole thing is dropped rather than pushed into the text.
 */
export function RunbookToc({
  container,
  pageKey,
}: {
  container: RefObject<HTMLElement | null>;
  /** Changes when the reader moves to another page, re-reading the headings. */
  pageKey: string;
}) {
  const headings = useHeadings(container, pageKey);
  const active = useActiveHeading(headings, container);

  // One heading is the page title over again, not a table of contents.
  if (headings.length < 2) return null;

  return (
    <div className="absolute inset-y-0 left-full hidden pl-5 @[67rem]/pane:block">
      <nav
        aria-label="On this page"
        className="sticky top-3 flex w-40 flex-col gap-0.5 @[76rem]/pane:w-44 @[88rem]/pane:w-52"
      >
        <span className={cn(groupLabelClass, "mb-1 px-2")}>On this page</span>
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            title={heading.text}
            aria-current={heading.id === active ? "true" : undefined}
            className={cn(
              "truncate rounded-md py-1.5 pr-2 text-[0.9375rem] text-muted-foreground transition-colors hover:text-foreground",
              heading.level === 3 ? "pl-5" : "pl-2",
              heading.id === active && "font-medium text-foreground",
            )}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </div>
  );
}
