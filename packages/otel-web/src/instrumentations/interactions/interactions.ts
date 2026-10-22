import type { Emit } from "../../pipeline/emitter.js";
import { epoch } from "../../time.js";
import { elementAttrs, guardOf, targetOf } from "../element.js";

// The interactions signal. It captures a click and a form submit. A click
// record names the element. A submit record names the button that caused the
// submit. The records carry no content of the DOM.
//
// The slow interactions are in the performance instrumentation. They use the
// event names, the element data, and the privacy limits of this module, through
// the shared functions in element.ts.
//
// The listener uses the capture phase. Thus it receives an event also when a
// different handler stops the propagation.

export function startInteractions(emit: Emit): () => void {
  const onClick = (event: MouseEvent) => {
    const el = targetOf(event);
    if (!el) return;
    emit("everr.browser.interaction.click", elementAttrs(el), epoch(event.timeStamp));
  };

  const onSubmit = (event: Event) => {
    // The code uses the button that caused the submit, which is
    // event.submitter. That is the element that the user operated, and thus the
    // record connects correctly to the clicks. If JS submits the form, there is
    // no submitter, and the code ignores the event, because the element that
    // the user operated is the necessary data.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- The native submit event supplies submitter; preserve the existing direct access and truthiness check.
    const submitter = (event as SubmitEvent).submitter;
    const el = submitter ? guardOf(submitter) : null;
    if (!el) return;
    emit("everr.browser.interaction.submit", elementAttrs(el), epoch(event.timeStamp));
  };

  addEventListener("click", onClick, true);
  addEventListener("submit", onSubmit, true);

  return () => {
    removeEventListener("click", onClick, true);
    removeEventListener("submit", onSubmit, true);
  };
}
