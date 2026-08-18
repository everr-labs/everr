import type { AttrValue } from "../pipeline/emitter.js";

// The shared data for a DOM element. Each signal that names a DOM element uses
// this module: the automatic capture of the interactions, the slow
// interactions, and the INP vital in the performance instrumentation.
//
// The code identifies an element by its structure only: the tag, a selector
// that does not change, and the href of the link that contains it. It reads no
// content of the DOM. Thus it reads no value of a field and no text of an
// element, and a record can carry no data of the user that the page shows.
// The naming attributes in the selector (`aria-label`, `type`, `name`,
// `title`, `alt`) are names that the developer writes, not content that the
// user enters. The
// other browser SDKs make the same decision: the XPath of OpenTelemetry, the
// tree of selectors of Sentry, and the data attribute of Faro all identify an
// element by its structure or by a name that the developer writes.
//
// The limits are part of the structure, and no option changes them. The code
// fully ignores a password input and a hidden input, and it sees nothing below
// an element that has the `everr-no-capture` class.

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
    "everr.element.selector": selectorOf(el),
    "everr.element.href": el.closest("a")?.getAttribute("href"),
    "everr.viewport.width": innerWidth,
    "everr.viewport.height": innerHeight,
  };
}

/** The attributes that name an element, in the order of preference. They are
 * the names that a developer writes and that a rebuild does not change. */
const NAME_ATTRS = ["aria-label", "type", "name", "title", "alt"];

/**
 * A CSS path that does not change. It starts at the nearest id, and below that
 * id it names an element by its tag, one naming attribute, and its stable
 * classes. A stable class is a plain name of letters, hyphens, and
 * underscores. A digit marks a hashed class of the CSS modules or a utility
 * class, which a rebuild or a layout change rewrites. Any other character
 * (the `:`, `[`, or `/` of a Tailwind variant) makes the class invalid in a
 * selector without an escape.
 * The position of the element is the last resort, when it has no attribute
 * and no stable class, because a new sibling changes the position. This is
 * the one method to write an element path in all the signals: the
 * interactions, the INP, and the targets of the LCP attribution and the CLS
 * attribution.
 */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let node: Element | null = el; node?.parentElement; ) {
    if (node.id) {
      // A plain id keeps the `#id` form; any other id needs an escape in a
      // selector, and the attribute form only has to escape its quotes.
      parts.unshift(
        /^[A-Za-z][\w-]*$/.test(node.id)
          ? `#${node.id}`
          : `[id="${node.id.replace(/"/g, '\\"')}"]`,
      );
      break;
    }
    let part = node.tagName.toLowerCase();
    let named = false;
    for (const name of NAME_ATTRS) {
      const value = node.getAttribute(name);
      if (value) {
        part += `[${name}="${value.replace(/"/g, '\\"')}"]`;
        named = true;
        break;
      }
    }
    const classes = [...node.classList]
      .filter((c) => /^[A-Za-z][A-Za-z_-]*$/.test(c))
      .slice(0, 3);
    if (classes.length) {
      part += `.${classes.join(".")}`;
    } else if (!named) {
      let nth = 1;
      for (let sib = node.previousElementSibling; sib; ) {
        if (sib.tagName === node.tagName) nth++;
        sib = sib.previousElementSibling;
      }
      if (nth > 1) part += `:nth-of-type(${nth})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}
