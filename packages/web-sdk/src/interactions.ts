import type { AttrValue, Emit } from "./emitter.js";

// The interactions signal: frustration detection only. The derived
// browser.interaction.rage_click / browser.interaction.dead_click events
// carry the full element payload; plain clicks, changes, and submits are
// deliberately not captured (amended 2026-07-23).
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

export function startInteractions(emit: Emit): () => void {
  // PostHog-style thresholds: three clicks within 30px at gaps of at most 1s
  // make a rage click; 3s without a page reaction makes a dead click.
  let rage: [x: number, y: number, at: number, count: number] | undefined;
  let lastActivity = 0;
  let deadTimer: ReturnType<typeof setTimeout> | undefined;

  // Anything the page does in response to a click (DOM changes, scrolling,
  // text selection, navigation) disqualifies it as a dead click.
  const onActivity = () => {
    lastActivity = Date.now();
  };
  // Armed only while a dead-click candidate is pending: delivering mutation
  // records on every DOM change is too expensive to run for the SDK's
  // lifetime.
  const observer = new MutationObserver(onActivity);

  const onClick = (event: MouseEvent) => {
    const el = targetOf(event);
    if (!el) return;
    const x = event.clientX + scrollX;
    const y = event.clientY + scrollY;

    const now = Date.now();
    rage =
      rage &&
      now - rage[2] <= 1_000 &&
      Math.hypot(x - rage[0], y - rage[1]) <= 30
        ? [x, y, now, rage[3] + 1]
        : [x, y, now, 1];
    if (rage[3] === 3) {
      emit("browser.interaction.rage_click", clickAttrs(el, x, y));
      rage = undefined;
    }

    if (!el.closest(INTERACTIVE)) {
      const url = location.href;
      // One pending candidate: a newer inert click replaces the older one.
      // documentElement, not body: it always exists, even for an init in <head>.
      // Attrs are captured at click time; the element may be gone at fire time.
      const attrs = clickAttrs(el, x, y);
      clearTimeout(deadTimer);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      deadTimer = setTimeout(() => {
        observer.disconnect();
        if (lastActivity < now && location.href === url) {
          emit("browser.interaction.dead_click", attrs);
        }
      }, 3_000);
    }
  };

  // Capture phase: see clicks even when handlers stop propagation.
  addEventListener("click", onClick, true);
  addEventListener("scroll", onActivity, true);
  document.addEventListener("selectionchange", onActivity);

  return () => {
    observer.disconnect();
    clearTimeout(deadTimer);
    removeEventListener("click", onClick, true);
    removeEventListener("scroll", onActivity, true);
    document.removeEventListener("selectionchange", onActivity);
  };
}

function clickAttrs(el: Element, x: number, y: number) {
  return { ...elementAttrs(el), "everr.click.x": x, "everr.click.y": y };
}

function targetOf(event: Event): Element | null {
  const el = event.target instanceof Element ? event.target : null;
  return !el ||
    el.closest(".everr-no-capture") ||
    el.matches("input[type=password],input[type=hidden]")
    ? null
    : el;
}

function elementAttrs(
  el: Element,
): Record<string, AttrValue | null | undefined> {
  return {
    "everr.element.tag": el.tagName.toLowerCase(),
    "everr.element.text": textOf(el),
    "everr.element.selector": selectorOf(el),
    "everr.element.chain": chainOf(el),
    "everr.element.href": el.closest("a")?.getAttribute("href"),
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
