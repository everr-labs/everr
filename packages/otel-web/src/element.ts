import type { AttrValue } from "./emitter.js";

// The shared data for a DOM element, and the limits that keep the data private.
// Each signal that names a DOM element uses this module: the automatic capture
// of the interactions, the slow interactions, and the INP vital in the
// performance instrumentation.
//
// The limits are part of the structure, and no option changes them. The code
// never reads the value of an element. It fully ignores a password input and a
// hidden input. It decreases the length of the text that it captures, and it
// discards that text when the text looks like a card number or an SSN. The code
// sees nothing below an element that has the `everr-no-capture` class.

// The structure of a card number, which has 13 to 16 digits with optional
// spaces or dashes, or the structure of an SSN. These patterns are separate
// from the redaction patterns of @everr/otel-errors, and this is correct. The
// browser entry has no dependencies. Thus the two sets of patterns can become
// different. Examine this again if they become the same.
const SENSITIVE_TEXT = /\b(?:\d[ -]?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/;
export const FORM_FIELDS = "input,textarea,select";

/** The shared test before a capture. It refuses the regions that have the
 * no-capture class, the password inputs, and the hidden inputs. */
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
  // The content of a form field is a value and not text. Thus the code ignores
  // an element that is a field, an element that is in a field, and an element
  // that contains a field. Without the last test, textContent gives the default
  // value of a textarea.
  if (el.closest(FORM_FIELDS) || el.querySelector(FORM_FIELDS)) {
    return undefined;
  }
  // This limits the work on a very large container. But the window for the
  // pattern test is larger than the limit on the text. Thus the code finds a
  // card number that is partially before position 256 and partially after it.
  const text = el.textContent?.slice(0, 1000).replace(/\s+/g, " ").trim();
  return text && !SENSITIVE_TEXT.test(text) ? text.slice(0, 256) : undefined;
}

/**
 * A CSS path that does not change. It starts at the nearest id, and below that
 * id it uses the positions of the elements. This is the one method to write an
 * element path in all the signals: the interactions, the INP, and the targets
 * of the LCP attribution and the CLS attribution.
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
