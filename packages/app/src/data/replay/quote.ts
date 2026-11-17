// Quotes the ids and times an error message names. A value from telemetry is
// quoted on one line with control and invisible characters removed, so a
// message is always one line and a terminal shows what it held.

const ID_CAP = 64;

// Lone surrogates first: they would otherwise survive as escapes.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// C0 controls other than whitespace, DEL and C1 controls, soft hyphen, the
// Arabic letter mark, zero-width and bidi controls, invisible operators, the
// byte order mark, interlinear annotations, Unicode tag characters, and the
// supplementary variation selectors used to hide data. The selectors come
// first: they are combining marks, and one after another character in a class
// reads as a combining sequence to the linter.
const INVISIBLE =
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point of this pattern.
  /[\u{E0100}-\u{E01EF}\u0000-\u0008\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;

const visible = (raw: string) => raw.replace(LONE_SURROGATE, "\uFFFD").replace(INVISIBLE, "");

/** JSON string literal of `raw`: nothing invisible, whitespace collapsed, at most `max` code points. */
export function q(raw: string, max: number): string {
  const text = visible(raw).replace(/\s+/g, " ").trim();
  const points = Array.from(text);
  return JSON.stringify(
    points.length > max ? `${points.slice(0, Math.max(0, max - 3)).join("")}...` : text,
  );
}

/** A Clip or Stream id as the SDK writes it. */
const HEX_ID = /^[0-9a-f]{8,64}$/;

/** Lowercase hex (8 to 64 digits) printed bare; anything else is quoted (ids from telemetry are untrusted too). */
export function hexId(raw: string): string {
  return HEX_ID.test(raw) ? raw : q(raw, ID_CAP);
}

/** 3m12s, 41s, 2h05m: a distance for a message. */
export function distance(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}
