import { elementAttrs, FORM_FIELDS, guardOf, targetOf } from "../../element.js";
import type { Emit } from "../../emitter.js";

// The interactions signal: product-analytics autocapture plus
// frustration detection. The autocapture half covers form-field `change` and
// `submit`; the frustration half covers rage and dead clicks. Slow
// interactions (Event Timing) live in the performance instrumentation, sharing the
// observer that computes INP, but keep this module's taxonomy, element
// payload, and privacy perimeter (via the shared element.ts helpers): every
// event carries tag/selector/chain, the autocapture events are gated by the
// structural privacy guards, and rage/dead stay the only signals that carry
// pointer coordinates (Event Timing reports none).
//
// This is the interim ungated emitter: every qualifying interaction ships
// immediately through the batch pipeline. The eventual breadcrumb model will
// gate raw autocapture behind an "interesting event" (error, slow click,
// dead/rage click); the element/guard helpers are reused verbatim, only the
// gating changes.

export function startInteractions(emit: Emit): () => void {
  // Rage-click thresholds: three clicks within 30px at gaps of at most 1s
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
        "everr.browser.click.x": x,
        "everr.browser.click.y": y,
      });
    } else {
      emit("everr.browser.interaction.click", {
        ...elementAttrs(el),
        "everr.browser.click.x": x,
        "everr.browser.click.y": y,
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

  return () => {
    removeEventListener("click", onClick, true);
    removeEventListener("change", onChange, true);
    removeEventListener("submit", onSubmit, true);
  };
}
