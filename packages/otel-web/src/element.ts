import type { AttrValue } from "./emitter.js";

// The shared element payload and privacy perimeter, used by every signal
// that names a DOM element (interactions autocapture, slow interactions and
// the INP vital in the performance instrumentation). Guardrails are structural, not
// configurable: element values are never read, password and hidden inputs
// are skipped entirely, captured text is capped and dropped when it looks
// like a card or SSN, and anything under an `everr-no-capture` class is
// invisible.

// Card-number (13-16 digits, optionally spaced/dashed) or SSN shaped.
// Deliberately independent of @everr/otel-errors' scrub patterns: the browser
// entry stays zero-dep, so the shapes may drift; revisit if they converge.
const SENSITIVE_TEXT = /\b(?:\d[ -]?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/;
export const FORM_FIELDS = "input,textarea,select";

/** The shared capture guard: no-capture regions and password/hidden inputs. */
export function guardOf(el: Element): Element | null {
  return el.closest(".everr-no-capture") ||
    el.matches("input[type=password],input[type=hidden]")
    ? null
    : el;
}

export function targetOf(event: Event): Element | null {
  const el = event.target instanceof Element ? event.target : null;
  return el ? guardOf(el) : null;
}

export function elementAttrs(
  el: Element,
): Record<string, AttrValue | null | undefined> {
  return {
    "everr.element.tag": el.tagName.toLowerCase(),
    "everr.element.text": textOf(el),
    "everr.element.selector": selectorOf(el),
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

/**
 * A stable CSS path: anchored at the nearest id, positional below it. The
 * one spelling of an element path across signals (interactions, INP, and
 * the LCP/CLS attribution targets).
 */
export function selectorOf(el: Element): string {
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
