import type { AttrValue, Emitter } from "./emitter.js";

// The interactions signal: browser.click (heatmap-ready payload),
// browser.change and browser.submit (never any values), and the derived
// browser.rage_click / browser.dead_click detectors.
//
// Privacy guardrails are structural, not configurable: element values are
// never read, password and hidden inputs are skipped entirely, captured text
// is capped and dropped when it looks like a card or SSN, and anything under
// an `everr-no-capture` class is invisible.

// Card-number (13-16 digits, optionally spaced/dashed) or SSN shaped.
// Deliberately independent of @everr/auto-otel-errors' scrub patterns: this
// package stays zero-dep, so the shapes may drift; revisit if they converge.
const SENSITIVE_TEXT = /\b(?:\d[ -]?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/;
const INTERACTIVE =
  "a,button,input,select,textarea,label,summary,[role=button],[onclick],[tabindex]";
const FORM_FIELDS = "input,textarea,select";

// PostHog-style thresholds.
const RAGE_CLICKS = 3;
const RAGE_RADIUS_PX = 30;
const RAGE_GAP_MS = 1_000;
const DEAD_WAIT_MS = 3_000;

export function startInteractions(emitter: Emitter): () => void {
  let rage: { x: number; y: number; at: number; count: number } | undefined;
  let lastActivity = 0;
  let deadTimer: ReturnType<typeof setTimeout> | undefined;

  // Anything the page does in response to a click (DOM changes, scrolling,
  // text selection, navigation) disqualifies it as a dead click.
  const onActivity = () => {
    lastActivity = Date.now();
  };
  // Armed only while a dead-click candidate is pending: delivering mutation
  // records on every DOM change is too expensive to run for the SDK's
  // lifetime. documentElement, not body: it always exists, even for an init
  // in <head>.
  const observer = new MutationObserver(onActivity);
  const armObserver = () =>
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

  const onClick = (event: MouseEvent) => {
    const el = targetOf(event);
    if (!el) return;
    const x = event.clientX + scrollX;
    const y = event.clientY + scrollY;
    const attrs = {
      ...elementAttrs(el),
      "everr.click.x": x,
      "everr.click.y": y,
    };
    emitter.emit("browser.click", attrs);

    const now = Date.now();
    rage =
      rage &&
      now - rage.at <= RAGE_GAP_MS &&
      Math.hypot(x - rage.x, y - rage.y) <= RAGE_RADIUS_PX
        ? { x, y, at: now, count: rage.count + 1 }
        : { x, y, at: now, count: 1 };
    if (rage.count === RAGE_CLICKS) {
      emitter.emit("browser.rage_click", attrs);
      rage = undefined;
    }

    if (!el.closest(INTERACTIVE)) {
      const url = location.href;
      // One pending candidate: a newer inert click replaces the older one.
      clearTimeout(deadTimer);
      armObserver();
      deadTimer = setTimeout(() => {
        observer.disconnect();
        if (lastActivity < now && location.href === url) {
          emitter.emit("browser.dead_click", attrs);
        }
      }, DEAD_WAIT_MS);
    }
  };

  const forward = (eventName: string) => (event: Event) => {
    const el = targetOf(event);
    if (el) emitter.emit(eventName, elementAttrs(el));
  };
  const onChange = forward("browser.change");
  const onSubmit = forward("browser.submit");

  // Capture phase: see interactions even when handlers stop propagation.
  addEventListener("click", onClick, true);
  addEventListener("change", onChange, true);
  addEventListener("submit", onSubmit, true);
  addEventListener("scroll", onActivity, true);
  document.addEventListener("selectionchange", onActivity);

  return () => {
    observer.disconnect();
    clearTimeout(deadTimer);
    removeEventListener("click", onClick, true);
    removeEventListener("change", onChange, true);
    removeEventListener("submit", onSubmit, true);
    removeEventListener("scroll", onActivity, true);
    document.removeEventListener("selectionchange", onActivity);
  };
}

function targetOf(event: Event): Element | null {
  const el = event.target instanceof Element ? event.target : null;
  if (!el || el.closest(".everr-no-capture")) return null;
  if (
    el instanceof HTMLInputElement &&
    (el.type === "password" || el.type === "hidden")
  ) {
    return null;
  }
  return el;
}

function elementAttrs(el: Element): Record<string, AttrValue | undefined> {
  return {
    "everr.element.tag": el.tagName.toLowerCase(),
    "everr.element.text": textOf(el),
    "everr.element.selector": selectorOf(el),
    "everr.element.chain": chainOf(el),
    "everr.element.href": el.closest("a")?.getAttribute("href") ?? undefined,
    "everr.viewport.width": innerWidth,
    "everr.viewport.height": innerHeight,
  };
}

function textOf(el: Element): string | undefined {
  // Form-field content is a value, not text: skip when the element is (or is
  // inside) a field, and when its subtree contains one (textContent would
  // include a textarea's default value).
  if (el.closest(FORM_FIELDS) || el.querySelector(FORM_FIELDS)) {
    return undefined;
  }
  // Bound the work on huge containers, but keep the scrub window wider than
  // the cap so a card number straddling the 256 boundary still matches.
  const text = el.textContent?.slice(0, 1000).replace(/\s+/g, " ").trim();
  return text && !SENSITIVE_TEXT.test(text) ? text.slice(0, 256) : undefined;
}

/** A stable CSS path: anchored at the nearest id, positional below it. */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node?.parentElement; ) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    let nth = 1;
    for (let sib = node.previousElementSibling; sib; ) {
      if (sib.tagName === node.tagName) nth++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(nth > 1 ? `${tag}:nth-of-type(${nth})` : tag);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

/** Compact ancestor chain (tag plus up to three classes per level). */
function chainOf(el: Element): string {
  const parts: string[] = [];
  for (
    let node: Element | null = el;
    node && node.tagName !== "HTML" && parts.length < 10;
    node = node.parentElement
  ) {
    parts.push(
      [
        node.tagName.toLowerCase(),
        ...Array.from(node.classList).slice(0, 3),
      ].join("."),
    );
  }
  return parts.join(";");
}
