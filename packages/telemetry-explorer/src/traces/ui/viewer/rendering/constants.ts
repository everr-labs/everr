// Third-party attribution and license: see the root NOTICE and LICENSE in this directory.
// SPDX-License-Identifier: MIT
// Adapted for Everr. See README.md for upstream provenance and changes.

const ROW_HEIGHT = 24;
const SPAN_BAR_HEIGHT = 22;
const EVENT_DOT_SIZE = 6;

// Span bar sizing relative to row height (used by getFlamegraphRowMetrics)
export const SPAN_BAR_HEIGHT_RATIO = SPAN_BAR_HEIGHT / ROW_HEIGHT;
export const MIN_SPAN_BAR_HEIGHT = 8;
export const MAX_SPAN_BAR_HEIGHT = SPAN_BAR_HEIGHT;

// Event dot sizing relative to span bar height
export const EVENT_DOT_SIZE_RATIO = EVENT_DOT_SIZE / SPAN_BAR_HEIGHT;
export const MIN_EVENT_DOT_SIZE = 4;
export const MAX_EVENT_DOT_SIZE = EVENT_DOT_SIZE;

export const LABEL_FONT = "500 11px Inter, sans-serif";
export const LABEL_PADDING_X = 8;
export const MIN_WIDTH_FOR_NAME = 30;
export const MIN_WIDTH_FOR_NAME_AND_DURATION = 80;

// Selected span style (dashed border)
export const DASHED_BORDER_LINE_DASH = [4, 2];
