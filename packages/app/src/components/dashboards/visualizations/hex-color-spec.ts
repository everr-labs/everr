import * as z from "zod";

// Opaque hex only: these colors fill shapes that carry text, and the readable
// foreground cannot be computed for colors with alpha, CSS variables, or
// syntaxes such as oklch().
export const hexColorSpec = z
  .string()
  .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, "must be an opaque hex color like #22c55e");
