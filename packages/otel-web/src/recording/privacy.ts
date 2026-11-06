import type { record } from "@rrweb/record";
import { NO_CAPTURE } from "../instrumentations/element.js";
import type { RecordingOptions } from "../recording.js";

type RecordOptions = NonNullable<Parameters<typeof record>[0]>;
export type FormElement = Element & { type?: string; value?: string };

const MEDIA = 'img,svg,video,object,picture,embed,map,audio,link[rel*="icon"]';
const DEFAULT_ATTRIBUTES = ["title", "placeholder", "aria-label", "content", "data-*"];
// The data-* keys of component state that UI kits style by, as in Radix and
// shadcn selectors like [data-state=open]. Their values are a small vocabulary,
// and a masked value makes the replay show the wrong state. A boolean key such
// as data-disabled is empty, and a mask keeps it as it is. Only the default
// list keeps these; a maskAttributes list masks as it says.
const UI_STATE = /^data-(state|side|align|orientation|slot|variant|size|motion|swipe)$/;
// A reference to an element of the page, as in <use href="#icon"> or a
// url(#clip) that rrweb keeps relative. It holds an id, not data.
const LOCAL_REF = /^\s*#[\w:.-]*\s*$/;
const URL_ATTRIBUTES = /^(href|src|srcset|action|formaction|poster|cite|background|ping)$/;
// The url() shapes rrweb 2.1.7 copies unchanged from a style attribute, a
// stylesheet's _cssText, and the text of a style element.
const CSS_URL = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gi;
// The input types whose value rrweb hands to maskInputFn when maskAllInputs is
// true. rrweb copies every other value as is: hidden, checkbox, radio, button,
// and the options of a select.
const RRWEB_MASKED =
  /^(color|date|datetime-local|email|month|number|range|search|tel|text|time|url|week|password|textarea|select)$/;

const stars = (text: string) => text.replace(/\S/g, "*");

/**
 * A URL without its query and fragment. A mailto:, tel:, or sms: URL keeps its
 * scheme only. A reference to an element of the page stays whole.
 */
const stripUrl = (url: string) =>
  LOCAL_REF.test(url)
    ? url
    : url.replace(/^\s*(mailto|tel|sms):.*$/is, "$1:").replace(/[?#][^\s,]*/g, "");

// The whole capture is one URL, so a comma inside the query goes too.
// A data: URL stays whole: its payload can contain ? and #, and it is the image.
// An unquoted capture can hold quotes, as `url( 'a?b' )` does after rrweb makes
// it absolute. The cut keeps those quotes, so the CSS after it still parses.
const stripCssUrls = (css: string) =>
  css.replace(
    CSS_URL,
    (
      match,
      q1: string | undefined,
      p1: string | undefined,
      q2: string | undefined,
      p2: string | undefined,
      p3: string | undefined,
    ) => {
      const raw = p1 ?? p2 ?? p3 ?? "";
      if (/^\s*data:/i.test(raw) || LOCAL_REF.test(raw)) return match;
      const quote = q1 ?? q2 ?? "";
      const kept = raw.replace(/[?#].*/s, (cut) => cut.replace(/[^'"]/g, ""));
      return `url(${quote}${kept}${quote})`;
    },
  );

// A style mutation may be the whole attribute, or rrweb's per-property diff:
// a string, or [value, priority].
const stripStyle = (value: unknown): unknown => {
  if (typeof value === "string") return stripCssUrls(value);
  if (Array.isArray(value))
    return typeof value[0] === "string" ? [stripCssUrls(value[0]), ...value.slice(1)] : value;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = stripStyle(item);
  return out;
};

/**
 * The rrweb options of the privacy defaults, and the scrub for the parts that
 * rrweb 2.1.7 leaves in the clear: attributes, CSS urls, the value of the inputs
 * that maskInputFn never sees, and the URL of the page.
 */
export function privacy(options: RecordingOptions, nodeOf: (id: number) => Node | null) {
  const element = (id: number): FormElement | null => {
    const node = nodeOf(id);
    return node instanceof Element ? node : null;
  };
  const inStyle = (id: number) => nodeOf(id)?.parentElement?.tagName.toLowerCase() === "style";
  const list = (selectors: string[] | undefined, ...markers: string[]) =>
    [...(selectors ?? []), ...markers].filter(Boolean).join(",");
  const unmask = options.unmask?.join(",");
  const masked = list(options.mask, ".everr-mask", "[data-everr-mask]");
  const mask = options.maskFn ?? stars;
  const unmasked = (el: Element | null) => !!unmask && !!el?.closest(unmask);
  const typeOf = (el: FormElement) =>
    el.hasAttribute("data-rr-is-password")
      ? "password"
      : (el.tagName === "INPUT" ? (el.type ?? "text") : el.tagName).toLowerCase();

  const maskInput = (text: string, el: FormElement | null): string => {
    if (el && typeOf(el) === "password") return stars(text);
    if (unmasked(el)) return text;
    if (options.maskAllInputs === false && !el?.closest(masked)) return text;
    return mask(text);
  };
  const maskText = (text: string, el: HTMLElement | null) => (unmasked(el) ? text : mask(text));
  const maskAttribute = (name: string) =>
    !(options.maskAttributes === undefined && UI_STATE.test(name)) &&
    (options.maskAttributes ?? DEFAULT_ATTRIBUTES).some((pattern) =>
      pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name,
    );
  // A value that rrweb did not mask: a type it skips, or an empty current value,
  // for which rrweb keeps the value attribute of the HTML.
  const rawValue = (el: FormElement | null): el is FormElement =>
    !!el &&
    /^(INPUT|OPTION|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName) &&
    (!RRWEB_MASKED.test(typeOf(el)) || !el.value);

  const scrubAttributes = (el: FormElement | null, attributes: Record<string, unknown>) => {
    const out = { ...attributes };
    for (const [name, value] of Object.entries(out)) {
      if (typeof value === "string" && name === "value" && rawValue(el)) {
        if (typeOf(el) === "file") delete out.value;
        else out.value = maskInput(value, el);
      } else if (typeof value === "string" && URL_ATTRIBUTES.test(name))
        out[name] = stripUrl(value);
      else if (typeof value === "string" && maskAttribute(name) && !unmasked(el))
        out[name] = mask(value);
      else if (name === "style" || name === "_cssText") out[name] = stripStyle(value);
    }
    return out;
  };

  const ignore = [...(options.ignore ?? []), ".everr-ignore", "[data-everr-ignore]"];
  const rrweb = {
    maskAllInputs: true,
    maskInputFn: (text, el) => maskInput(text, el),
    maskTextFn: (text, el) => maskText(text, el),
    maskTextClass: "everr-mask",
    maskTextSelector: options.maskAllText === false ? masked : "*",
    blockClass: "everr-block",
    blockSelector: list(
      options.block,
      options.blockAllMedia === false ? "" : MEDIA,
      "base",
      "iframe[srcdoc]",
      "[data-everr-block]",
      NO_CAPTURE,
    ),
    ignoreClass: "everr-ignore",
    // rrweb tests the selector on the input itself, so the descendant form
    // makes Ignore cover the inputs inside an element.
    ignoreSelector: [
      ...ignore.flatMap((s) => [`:is(${s})`, `:is(${s}) *`]),
      'input[type="file"]',
    ].join(","),
  } satisfies RecordOptions;

  /** The JSON.stringify replacer of the emit path. It copies, and never changes rrweb's own nodes. */
  function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
    if (
      key === "attributes" &&
      typeof this.id === "number" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    )
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Checked above to be a plain object: the attribute map of an rrweb node or mutation.
      return scrubAttributes(element(this.id), value as Record<string, unknown>);
    // An Input event of a checkbox, a radio, or a hidden input carries the raw value.
    if (
      key === "text" &&
      this.source === 5 &&
      typeof value === "string" &&
      typeof this.id === "number"
    ) {
      const el = element(this.id);
      return rawValue(el) ? maskInput(value, el) : value;
    }
    // The Meta event carries the URL of the page.
    if (key === "href" && typeof value === "string" && "width" in this) return stripUrl(value);
    // The text of a style element, in the snapshot and in a later text mutation.
    if (
      (key === "textContent" || key === "value") &&
      typeof value === "string" &&
      typeof this.id === "number" &&
      inStyle(this.id)
    )
      return stripCssUrls(value);
    return value;
  }

  return { rrweb, replacer };
}
