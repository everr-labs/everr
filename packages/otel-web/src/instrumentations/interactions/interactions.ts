import { elementAttrs, FORM_FIELDS, guardOf, targetOf } from "../../element.js";
import type { Emit } from "../../emitter.js";

// The interactions signal. It captures the data for the product analytics
// automatically, and it finds the frustration of the user. The automatic
// capture covers a `change` event of a form field and a `submit` event. The
// frustration part covers a rage click and a dead click.
//
// The slow interactions are in the performance instrumentation, and they use
// the same observer that calculates the INP. But they use the event names, the
// element data, and the privacy limits of this module, through the shared
// functions in element.ts. Thus each event carries the tag, the selector, and
// the chain. The privacy limits in the structure control the events of the
// automatic capture. The rage click and the dead click are the only signals
// that carry the coordinates of the pointer, because Event Timing gives no
// coordinates.
//
// This emitter sends each interaction immediately on the batch pipeline, and
// this condition is temporary. The next model uses breadcrumbs. Then an
// interesting event controls the raw automatic capture, for example an error, a
// slow click, a dead click, or a rage click. That model uses the same functions
// for the element and the privacy limits, and only the control changes.

export function startInteractions(emit: Emit): () => void {
  // The limits for a rage click. Three clicks in an area of 30 px, with an
  // interval of a maximum of 1 s between them, make a rage click. An interval
  // of 3 s with no change of the page makes a dead click.
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

  // The listener uses the capture phase. Thus it receives a click also when a
  // different handler stops the propagation.
  addEventListener("click", onClick, true);

  const onChange = (event: Event) => {
    // The targetOf function applies the tests for the no-capture class, a
    // password input, and a hidden input. The closest(FORM_FIELDS) test permits
    // only the elements that the privacy limits know. Thus the code never
    // captures a `change` event of a different element automatically, for
    // example a div with contenteditable.
    const el = targetOf(event);
    if (!el?.closest(FORM_FIELDS)) return;
    emit("everr.browser.interaction.change", elementAttrs(el));
  };

  const onSubmit = (event: Event) => {
    // The code uses the button that caused the submit, which is
    // event.submitter. That is the element that the user operated, and thus the
    // record connects correctly to the clicks. If JS submits the form, there is
    // no submitter, and the code ignores the event, because the element that
    // the user operated is the necessary data.
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
