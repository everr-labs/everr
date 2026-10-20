// Privacy runs in the browser, before an event enters the buffer. Text, inputs,
// block, and ignore go through the public @rrweb/record options. rrweb 2.1.7
// has no attribute hook, so maskAttributes is applied in the emit callback.
//
// blockClass is checked before blockSelector and cannot express :not(), so
// unblock would lose to a marker class. Markers live in the selectors. The
// class options are a sentinel that matches nothing.

import { record } from "@rrweb/record";
import type { RecordingOptions } from "../recording.js";

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const INPUT = 5;
const ELEMENT = 2;

const SENTINEL_CLASS = "everr-privacy-off";

const MASK_MARKERS = [".everr-mask", "[data-everr-mask]"];
const BLOCK_MARKERS = [".everr-block", "[data-everr-block]"];
const IGNORE_MARKERS = [
  ".everr-ignore",
  "[data-everr-ignore]",
  'input[type="file"]',
];

const MEDIA = [
  "img",
  "svg",
  "video",
  "object",
  "picture",
  "embed",
  "map",
  "audio",
  'link[rel="icon"]',
  'link[rel="shortcut icon"]',
  'link[rel="apple-touch-icon"]',
];

// A srcdoc iframe is same-origin, so rrweb would record its document. base
// rewrites every URL at replay. Both stay blocked while the bundle is on.
// unblock wins, same as any other block selector.
const BUNDLE_BLOCK = ["base", "iframe[srcdoc]:not([src])"];

const DEFAULT_ATTRIBUTES = ["title", "placeholder", "aria-label"];

export type Privacy = {
  maskAllText: boolean;
  maskAllInputs: boolean;
  maskSelectors: string[];
  unmaskSelectors: string[];
  maskAttributes: string[];
  maskFn?: (text: string) => string;
  blockSelector: string;
  ignoreSelector: string;
};

type Serialized = {
  id?: number;
  type?: number;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, unknown>;
  childNodes?: Serialized[];
};

type MutationData = {
  source?: number;
  texts?: Array<{ id: number; value: string | null }>;
  attributes?: Array<{ id: number; attributes: Record<string, unknown> }>;
  adds?: Array<{ node?: Serialized }>;
  id?: number;
  text?: string;
};

type Payload = { node?: Serialized; source?: number } & MutationData;

function payload(data: unknown): Payload | null {
  if (typeof data !== "object" || data === null) return null;
  return data as Payload;
}

export function resolvePrivacy(
  dev: boolean,
  options?: RecordingOptions,
): Privacy {
  const bundle = dev !== true;
  const maskAllText = options?.maskAllText ?? bundle;
  const maskAllInputs = options?.maskAllInputs ?? bundle;
  const blockAllMedia = options?.blockAllMedia ?? bundle;
  const maskSelectors = [...MASK_MARKERS, ...(options?.mask ?? [])].filter(
    Boolean,
  );
  const unmaskSelectors = (options?.unmask ?? []).filter(Boolean);
  const blockSelectors = [
    ...BLOCK_MARKERS,
    ...(bundle ? BUNDLE_BLOCK : []),
    ...(blockAllMedia ? MEDIA : []),
    ...(options?.block ?? []),
  ].filter(Boolean);
  const maskAttributes = (
    options?.maskAttributes ?? (bundle ? DEFAULT_ATTRIBUTES : [])
  ).map((name) => name.toLowerCase());
  return {
    maskAllText,
    maskAllInputs,
    maskSelectors,
    unmaskSelectors,
    maskAttributes,
    maskFn: options?.maskFn,
    blockSelector: withUnblock(blockSelectors, options?.unblock ?? []),
    ignoreSelector: [...IGNORE_MARKERS, ...(options?.ignore ?? [])]
      .filter(Boolean)
      .join(","),
  };
}

export function recordPrivacy(privacy: Privacy): {
  blockClass: string;
  ignoreClass: string;
  maskTextClass: string;
  maskTextSelector: string;
  maskAllInputs: true;
  blockSelector: string;
  ignoreSelector: string;
  maskTextFn: (text: string, element: HTMLElement | null) => string;
  maskInputFn: (text: string, element: HTMLElement) => string;
} {
  return {
    blockClass: SENTINEL_CLASS,
    ignoreClass: SENTINEL_CLASS,
    maskTextClass: SENTINEL_CLASS,
    // `*` makes rrweb call maskTextFn for every text node. unmask is decided
    // there: a selector cannot both match all text and skip unmask.
    maskTextSelector: privacy.maskAllText
      ? "*"
      : privacy.maskSelectors.join(","),
    // Always on so maskInputFn runs for every value. The function returns the
    // original text when the value is not Masked, and it never returns a
    // password in the clear.
    maskAllInputs: true,
    blockSelector: privacy.blockSelector,
    ignoreSelector: privacy.ignoreSelector,
    maskTextFn: (text, element) =>
      shouldMaskText(privacy, element) ? applyMask(privacy, text) : text,
    maskInputFn: (text, element) =>
      shouldMaskInput(privacy, element) ? applyMask(privacy, text) : text,
  };
}

export function rewriteEvent(
  event: { type: number; data?: unknown },
  privacy: Privacy,
): void {
  const data = payload(event.data);
  if (!data) return;
  if (event.type === FULL_SNAPSHOT && data.node) {
    walk(data.node, privacy);
    return;
  }
  if (event.type !== INCREMENTAL) return;
  if (data.source === MUTATION) {
    for (const change of data.attributes ?? []) {
      rewriteAttributeMap(change.id, change.attributes, privacy);
    }
    for (const add of data.adds ?? []) {
      if (add.node) walk(add.node, privacy);
    }
    return;
  }
  if (
    data.source === INPUT &&
    data.id != null &&
    isFileElement(liveElement(data.id))
  ) {
    data.text = "";
  }
}

function walk(node: Serialized, privacy: Privacy): void {
  if (node.type === ELEMENT && node.attributes) {
    if (isFileNode(node)) delete node.attributes.value;
    else maskSubmitValue(node, privacy);
    if (node.id != null) rewriteAttributeMap(node.id, node.attributes, privacy);
  }
  if (!node.childNodes) return;
  for (const child of node.childNodes) walk(child, privacy);
}

function maskSubmitValue(node: Serialized, privacy: Privacy): void {
  if (node.tagName !== "input" || !node.attributes) return;
  const type = String(node.attributes.type ?? "").toLowerCase();
  if (type !== "submit" && type !== "button") return;
  const element = node.id == null ? null : liveElement(node.id);
  const raw =
    element instanceof HTMLInputElement
      ? element.value
      : typeof node.attributes.value === "string"
        ? node.attributes.value
        : "";
  if (!raw) return;
  const mask =
    element instanceof HTMLElement
      ? shouldMaskInput(privacy, element)
      : privacy.maskAllInputs;
  if (!mask) return;
  node.attributes.value = applyMask(privacy, raw);
}

function rewriteAttributeMap(
  id: number,
  attributes: Record<string, unknown>,
  privacy: Privacy,
): void {
  const element = liveElement(id);
  if (isFileElement(element) && "value" in attributes) delete attributes.value;
  if (privacy.maskAttributes.length === 0) return;
  if (element && unmaskWins(privacy, element)) return;
  for (const key of Object.keys(attributes)) {
    if (!privacy.maskAttributes.includes(key.toLowerCase())) continue;
    const value = attributes[key];
    if (typeof value !== "string" || value.length === 0) continue;
    attributes[key] = applyMask(privacy, value);
  }
}

function applyMask(privacy: Privacy, text: string): string {
  return privacy.maskFn ? privacy.maskFn(text) : "*".repeat(text.length);
}

function shouldMaskText(
  privacy: Privacy,
  element: HTMLElement | null,
): boolean {
  if (!element) return true;
  if (unmaskWins(privacy, element)) return false;
  if (closestDepth(element, privacy.maskSelectors) != null) return true;
  return privacy.maskAllText;
}

function shouldMaskInput(privacy: Privacy, element: HTMLElement): boolean {
  if (isPassword(element)) return true;
  if (unmaskWins(privacy, element)) return false;
  if (closestDepth(element, privacy.maskSelectors) != null) return true;
  return privacy.maskAllInputs;
}

function unmaskWins(privacy: Privacy, element: Element): boolean {
  const unmaskDepth = closestDepth(element, privacy.unmaskSelectors);
  if (unmaskDepth == null) return false;
  const maskDepth = closestDepth(element, privacy.maskSelectors);
  return maskDepth == null || unmaskDepth <= maskDepth;
}

function isPassword(element: HTMLElement): boolean {
  if (element.hasAttribute("data-rr-is-password")) return true;
  return (
    element instanceof HTMLInputElement &&
    element.type.toLowerCase() === "password"
  );
}

function isFileNode(node: Serialized): boolean {
  return (
    node.tagName === "input" &&
    String(node.attributes?.type ?? "").toLowerCase() === "file"
  );
}

function isFileElement(element: Element | null): boolean {
  return element instanceof HTMLInputElement && element.type === "file";
}

function liveElement(id: number): Element | null {
  const node = record.mirror.getNode(id);
  if (!node || node.nodeType !== node.ELEMENT_NODE) return null;
  return node as Element;
}

function closestDepth(
  element: Element,
  selectors: readonly string[],
): number | null {
  let best: number | null = null;
  for (const selector of selectors) {
    let match: Element | null;
    try {
      match = element.closest(selector);
    } catch {
      continue;
    }
    if (!match) continue;
    let depth = 0;
    let node: Element | null = element;
    while (node && node !== match) {
      depth += 1;
      node = node.parentElement;
    }
    if (best == null || depth < best) best = depth;
  }
  return best;
}

function withUnblock(selectors: string[], unblock: string[]): string {
  const exceptions = unblock.filter(Boolean);
  if (exceptions.length === 0) return selectors.join(",");
  // rrweb matches each element on its own, so unblock is :not() on that
  // element. A blocked parent still drops its children.
  const suffix = exceptions.map((selector) => `:not(${selector})`).join("");
  return selectors.map((selector) => `${selector}${suffix}`).join(",");
}
