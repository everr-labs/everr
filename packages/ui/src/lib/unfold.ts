/**
 * How a block opens and closes: on the sidebar's curve and in the sidebar's 200ms.
 * Drags and arrow keys on a resize handle stay direct and never animate. Where the
 * browser cannot animate, or the reader asks for less motion, the size changes at
 * once and only a short fade marks the opening and the closing.
 */
const DURATION_MS = 200;
const FADE_MS = 120;

/** Settles when the motion ends or a later one replaces it; `undefined` when nothing moves. */
export type Motion = Promise<void> | undefined;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animatable(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && typeof element.animate === "function";
}

/** `--ease-sidebar`. WAAPI takes no `var()`, so the curve is read from the page. */
function ease(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--ease-sidebar").trim() ||
    "ease-out"
  );
}

/** A cancelled run counts as ended: whatever replaced it owns the element now. */
function ended(runs: Animation[]): Promise<void> {
  return Promise.allSettled(runs.map((run) => run.finished)).then(() => undefined);
}

function stop(element: HTMLElement) {
  for (const run of element.getAnimations()) run.cancel();
}

/** The panel's content box, which the panel library draws inside each panel. */
function content(panel: HTMLElement): HTMLElement | undefined {
  const box = panel.firstElementChild;
  return box instanceof HTMLElement ? box : undefined;
}

/** Each pinned panel, with the motion that pinned it and how to let it go. */
const pins = new WeakMap<HTMLElement, { motion: object; release: () => void }>();

/** Holds a panel's content at `height` and clips it to the panel. */
function pin(panel: HTMLElement, height: number, motion: object) {
  const box = content(panel);
  if (!box) return;
  pins.get(panel)?.release();
  const before = {
    overflow: panel.style.overflow,
    height: box.style.height,
    maxHeight: box.style.maxHeight,
  };
  panel.style.overflow = "hidden";
  box.style.maxHeight = "none";
  box.style.height = `${height}px`;
  pins.set(panel, {
    motion,
    release: () => {
      panel.style.overflow = before.overflow;
      box.style.height = before.height;
      box.style.maxHeight = before.maxHeight;
      pins.delete(panel);
    },
  });
}

function unpin(panel: HTMLElement, motion: object) {
  const held = pins.get(panel);
  if (held?.motion === motion) held.release();
}

function panelsOf(group: Element): HTMLElement[] {
  return [...group.children].filter(
    (child): child is HTMLElement => animatable(child) && child.hasAttribute("data-panel"),
  );
}

/** The height of a panel's content, which a pin can hold above the panel's own. */
function contentHeight(panel: HTMLElement): number {
  return content(panel)?.getBoundingClientRect().height ?? 0;
}

type Move = {
  panel: HTMLElement;
  /** The `flex-grow` it moves from. */
  from: string;
  /** The `flex-grow` it moves to; left out, it is the share the panel library drew. */
  to?: string;
  /** What its content is held at while it moves. */
  height: number;
};

function move(group: Element, moves: Move[]): Promise<void> {
  const motion = {};
  if (getComputedStyle(group).flexDirection === "column") {
    for (const { panel, height } of moves) pin(panel, height, motion);
  }
  const easing = ease();
  const runs = moves.map(({ panel, from, to }) =>
    to === undefined
      ? panel.animate([{ flexGrow: from, offset: 0 }], { duration: DURATION_MS, easing })
      : panel.animate([{ flexGrow: from }, { flexGrow: to }], {
          duration: DURATION_MS,
          easing,
          fill: "forwards",
        }),
  );
  return ended(runs).then(() => {
    for (const { panel } of moves) unpin(panel, motion);
  });
}

/**
 * Runs `change`, which resizes the panels of a vertical split or adds one, and
 * eases every panel from the share it had to the share it gets. A panel that
 * `change` adds grows from nothing. The panel library draws the new layout when
 * React renders, so `change` must render at once, as the state updates of a click
 * handler do. The motion starts in a microtask after that render, so no frame is
 * painted between the motion it replaces and this one.
 *
 * While the panels move, the content of each one keeps the larger of its two sizes
 * and the panel clips it. A growing panel uncovers its content instead of stretching
 * it, a shrinking one covers it, and no content is laid out again on every frame.
 */
export function easeSplit(anchor: HTMLElement | null, change: () => void): Motion {
  const group = anchor?.parentElement;
  if (!animatable(anchor) || !group || reducedMotion()) {
    change();
    return undefined;
  }
  // Content that a motion this one interrupts still holds keeps its size.
  const before = new Map(
    panelsOf(group).map((panel) => [
      panel,
      { grow: getComputedStyle(panel).flexGrow, height: contentHeight(panel) },
    ]),
  );
  for (const panel of before.keys()) stop(panel);
  change();
  return new Promise((resolve) => {
    queueMicrotask(() => {
      const panels = panelsOf(group);
      const drawn = panels.map((panel) => panel.getBoundingClientRect().height);
      void move(
        group,
        panels.map((panel, index) => ({
          panel,
          from: before.get(panel)?.grow ?? "0",
          height: Math.max(before.get(panel)?.height ?? 0, drawn[index]),
        })),
      ).then(resolve);
    });
  });
}

/**
 * Eases one panel of a vertical split down to nothing, for the caller to remove it
 * once the motion ends. The other panels take its space by their shares.
 */
export function easeAway(panel: HTMLElement | null): Motion {
  const group = panel?.parentElement;
  if (!animatable(panel) || !group || reducedMotion()) return undefined;
  const panels = panelsOf(group);
  // The others only grow, and never past the space of the whole split.
  const space = panels.reduce((sum, other) => sum + other.getBoundingClientRect().height, 0);
  const moves = panels.map((other) => ({
    panel: other,
    from: getComputedStyle(other).flexGrow,
    to: other === panel ? "0" : undefined,
    height: other === panel ? contentHeight(other) : Math.max(space, contentHeight(other)),
  }));
  for (const other of panels) stop(other);
  return move(group, moves);
}

/** Opens a block that sits in a scrolling column, from its current height. */
export function unfold(body: HTMLElement, fromHeight: number): Motion {
  if (!animatable(body)) return undefined;
  stop(body);
  if (reducedMotion()) {
    return ended([body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS })]);
  }
  const toHeight = body.getBoundingClientRect().height;
  return ended([
    body.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], {
      duration: DURATION_MS,
      easing: ease(),
    }),
  ]);
}

/** Fades in what a split opened at once for a reader who asks for less motion. */
export function fadeIn(body: HTMLElement): Motion {
  if (!animatable(body) || !reducedMotion()) return undefined;
  return ended([body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS })]);
}

/** Closes a block that sits in a scrolling column. It holds its end until it is removed. */
export function fold(body: HTMLElement | null): Motion {
  if (!animatable(body)) return undefined;
  const fromHeight = body.getBoundingClientRect().height;
  stop(body);
  const run = reducedMotion()
    ? body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" })
    : body.animate([{ height: `${fromHeight}px` }, { height: "0px" }], {
        duration: DURATION_MS,
        easing: ease(),
        fill: "forwards",
      });
  return ended([run]);
}
