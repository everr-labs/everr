import type { Emit } from "../../pipeline/emitter.js";
import { elementAttrs, guardOf, targetOf } from "../element.js";

// The interactions signal. It captures the data for the product analytics
// automatically, and it finds the frustration of the user. The automatic
// capture covers a `change` event of a form field and a `submit` event. The
// frustration part covers a rage click.
//
// The slow interactions are in the performance instrumentation, and they use
// the same observer that calculates the INP. But they use the event names, the
// element data, and the privacy limits of this module, through the shared
// functions in element.ts. Thus each event carries the tag, the selector, and
// the chain. The privacy limits in the structure control the events of the
// automatic capture. The click records are the only records that carry the
// coordinates of the pointer, because Event Timing gives no coordinates.
//
// This emitter sends each interaction immediately on the batch pipeline, and
// this condition is temporary. The next model uses breadcrumbs. Then an
// interesting event controls the raw automatic capture, for example an error, a
// slow click, a dead click, or a rage click. That model uses the same functions
// for the element and the privacy limits, and only the control changes.

// A surface where the user edits text. Two fast clicks and three fast clicks on
// such a surface select a word and select a line. They are the usual operation
// of the browser and they are not frustration. Thus they make no rage click.
// The selector uses closest(), because a click in a region with contenteditable
// has a child of that region as its target. A password input is not in the
// list, because guardOf refuses it before this code.
const TEXT_SELECTION_TARGET =
  "textarea,[contenteditable]:not([contenteditable=false])," +
  "input:not([type]),input[type=text],input[type=search],input[type=email]," +
  "input[type=url],input[type=tel],input[type=number]";

export function startInteractions(emit: Emit): () => void {
  // The limits for a rage click. Three clicks in an area of 30 px, with an
  // interval of a maximum of 1 s between them, make a rage click.
  let rage:
    | [x: number, y: number, at: number, count: number, first: number]
    | undefined;

  const onClick = (event: MouseEvent) => {
    const el = targetOf(event);
    if (!el) return;
    const x = event.clientX + scrollX;
    const y = event.clientY + scrollY;
    const attributes = {
      ...elementAttrs(el),
      "everr.browser.click.x": x,
      "everr.browser.click.y": y,
    };

    // The position and the time are always the values of this click: the
    // window follows the pointer. Only the count carries the history.
    const now = event.timeStamp;
    let count = 1;
    let first = now;
    if (
      rage &&
      now - rage[2] <= 1_000 &&
      Math.hypot(x - rage[0], y - rage[1]) <= 30
    ) {
      count = rage[3] + 1;
      first = rage[4];
    }
    rage = [x, y, now, count, first];
    // The test is on the count of exactly 3, and the code does not remove the
    // window after it sends the record. Thus one continuous burst makes one
    // rage click and not one for each three clicks: the count continues to 4,
    // to 5, and more, and it agrees with 3 no more.
    if (rage[3] === 3 && !el.closest(TEXT_SELECTION_TARGET)) {
      emit("everr.browser.interaction.rage_click", attributes, rage[4]);
    }
    // The rage click does not replace the click. Each click makes its own
    // record, and thus a count of the clicks on an element is correct.
    emit("everr.browser.interaction.click", attributes, event.timeStamp);
  };

  // The listener uses the capture phase. Thus it receives a click also when a
  // different handler stops the propagation.
  addEventListener("click", onClick, true);

  const onChange = (event: Event) => {
    // The targetOf function applies the tests for the no-capture class, a
    // password input, and a hidden input. There is no test on the type of the
    // element: a `change` event goes up the tree, and thus this code captures
    // one from a form field and also one from a different element, for example
    // a div with contenteditable or a custom element that sends its own event.
    // The record carries no content of the DOM in the two conditions.
    const el = targetOf(event);
    if (!el) return;
    emit("everr.browser.interaction.change", elementAttrs(el), event.timeStamp);
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
    emit("everr.browser.interaction.submit", elementAttrs(el), event.timeStamp);
  };

  addEventListener("change", onChange, true);
  addEventListener("submit", onSubmit, true);

  return () => {
    removeEventListener("click", onClick, true);
    removeEventListener("change", onChange, true);
    removeEventListener("submit", onSubmit, true);
  };
}
