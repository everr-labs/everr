import type { AttrValue, Emit } from "./emitter.js";

// The interactions signal: product-analytics autocapture (PostHog parity) plus
// frustration detection. The autocapture half covers slow clicks (from the
// Event Timing API), form-field `change`, and `submit`; the frustration half
// covers rage and dead clicks. One taxonomy, one element payload, one privacy
// perimeter: every event carries tag/selector/chain, the autocapture events
// are gated by the structural privacy guards, and rage/dead stay the only
// signals that carry pointer coordinates (Event Timing reports none).
//
// This is the interim ungated emitter: every qualifying interaction ships
// immediately through the batch pipeline. The eventual breadcrumb model will
// gate raw autocapture behind an "interesting event" (error, slow click,
// dead/rage click); the Event Timing observer and the element/guard helpers
// here are reused verbatim, only the gating changes.
//
// Privacy guardrails are structural, not configurable: element values are
// never read, password and hidden inputs are skipped entirely, captured text
// is capped and dropped when it looks like a card or SSN, and anything under
// an `everr-no-capture` class is invisible. `change` records target a
// form-field element and carry identity only (no value, no text, no length
// surrogate); `submit` records target the triggering submitter button.

// Card-number (13-16 digits, optionally spaced/dashed) or SSN shaped.
// Deliberately independent of @everr/auto-otel-errors' scrub patterns: this
// package stays zero-dep, so the shapes may drift; revisit if they converge.
const SENSITIVE_TEXT = /\b(?:\d[ -]?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/;
const FORM_FIELDS = "input,textarea,select";
const SLOW_INTERACTIONS_THRESHOLD = 200;

export function startInteractions(emit: Emit): () => void {
  // PostHog-style thresholds: three clicks within 30px at gaps of at most 1s
  // make a rage click; 3s without a page reaction makes a dead click.
  let rage: [x: number, y: number, at: number, count: number] | undefined;

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
    const isRageClick = rage[3] === 3;
    if (isRageClick) {
      rage = undefined;

      emit("everr.browser.interaction.rage_click", {
        ...elementAttrs(el),
        "everr.click.x": x,
        "everr.click.y": y,
      });
    } else {
      emit("everr.browser.interaction.click", {
        ...elementAttrs(el),
        "everr.click.x": x,
        "everr.click.y": y,
      });
    }
  };

  // Capture phase: see clicks even when handlers stop propagation.
  addEventListener("click", onClick, true);

  const onChange = (event: Event) => {
    // targetOf applies the no-capture / password / hidden guards; the
    // closest(FORM_FIELDS) check restricts to the same element set the
    // privacy perimeter already speaks, so non-field `change` (contenteditable
    // divs and the like) is never autocaptured.
    const el = targetOf(event);
    if (!el?.closest(FORM_FIELDS)) return;
    emit("everr.browser.interaction.change", elementAttrs(el));
  };

  const onSubmit = (event: Event) => {
    // Target the triggering button (event.submitter): the element the user
    // acted on, joining cleanly to the click stream. A JS-submitted form with
    // no submitter is skipped, since the interactive element is the point.
    const submitter = (event as SubmitEvent).submitter;
    const el = submitter ? guardOf(submitter) : null;
    if (!el) return;
    emit("everr.browser.interaction.submit", elementAttrs(el));
  };

  addEventListener("change", onChange, true);
  addEventListener("submit", onSubmit, true);
  const stopSlowInteractionsTracking = startSlowInteractionsTracking(emit);

  return () => {
    removeEventListener("click", onClick, true);
    removeEventListener("change", onChange, true);
    removeEventListener("submit", onSubmit, true);
    stopSlowInteractionsTracking();
  };
}

/** The shared capture guard: no-capture regions and password/hidden inputs. */
function guardOf(el: Element): Element | null {
  return el.closest(".everr-no-capture") ||
    el.matches("input[type=password],input[type=hidden]")
    ? null
    : el;
}

function targetOf(event: Event): Element | null {
  const el = event.target instanceof Element ? event.target : null;
  return el ? guardOf(el) : null;
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

function startSlowInteractionsTracking(emit: Emit): () => void {
  const onEntries = (entries: PerformanceEventTiming[]) => {
    for (const entry of entries) {
      if (entry.entryType !== "event") continue;
      const el = entry.target instanceof Element ? guardOf(entry.target) : null;
      if (!el) continue;

      emit("everr.browser.slow_interaction", {
        ...elementAttrs(el),
        "everr.interaction.name": entry.name,
        "everr.interaction.duration_ms": entry.duration,
      });
    }
  };

  let po: PerformanceObserver | undefined;
  try {
    po = new PerformanceObserver((list) =>
      onEntries(list.getEntries() as PerformanceEventTiming[]),
    );
    po.observe({
      type: "event",
      buffered: true,
      durationThreshold: SLOW_INTERACTIONS_THRESHOLD,
    });
  } catch {
    return () => {};
  }
  return () => po?.disconnect();
}
