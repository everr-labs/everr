# The extended 12-color series palette fails its own contrast floor

From the PR #225 review; see [pr-225-review-findings.md](./pr-225-review-findings.md),
finding 15.

## What
The shared series palette was extended from six colors to twelve so the SLO budget
chart could plot up to twelve groups. Run against the `dataviz` skill's validator
on the app's dark surface, the six new entries introduce perceptual-distance
failures the original six did not have.

The original six are fine. The extension is what breaks it.

## Where
`packages/app/src/components/dashboards/visualizations/data-utils.ts:21-33`:

```ts
export const SERIES_COLORS = [
  "hsl(217, 91%, 60%)", // blue
  "hsl(142, 71%, 45%)", // green
  "hsl(0, 84%, 60%)",   // red
  "hsl(280, 68%, 60%)", // purple
  "hsl(35, 92%, 50%)",  // orange
  "hsl(190, 90%, 50%)", // cyan
  "hsl(330, 80%, 62%)", // rose
  "hsl(85, 62%, 42%)",  // olive
  "hsl(250, 78%, 70%)", // indigo
  "hsl(168, 72%, 34%)", // deep teal
  "hsl(20, 68%, 44%)",  // rust
  "hsl(300, 44%, 48%)", // plum
];
```

Consumed at `packages/app/src/components/cc/slo-budget-chart.tsx:74`
(`const MAX_SERIES = SERIES_COLORS.length;`) and applied at `:258`
(`ranked.slice(0, MAX_SERIES)`).

## Measured
Validator output against the app's dark surface, floor is delta E 15:

| pair | condition | delta E | verdict |
|---|---|---|---|
| plum `hsl(300,44%,48%)` vs purple `hsl(280,68%,60%)` | normal vision | 7.2 | fail |
| olive `hsl(85,62%,42%)` vs orange `hsl(35,92%,50%)` | protanopia | 1.4 | fail |
| worst pair, original six only | normal vision | 17.3 | pass |
| worst pair, all twelve | normal vision | 7.2 | fail |

The olive result is the worse of the two in practice: at delta E 1.4 the two
series are effectively the same color for a protanopic reader, not merely close.

## Contradicted by its own comment
`data-utils.ts:29-33` justifies each new entry as sitting "in the widest remaining
hue gap" and being "darker, so it holds against green" or "lighter, so it holds
against blue/purple". The reasoning is right in principle (a lightness difference
survives color blindness where a hue difference does not) but the specific values
do not achieve it. Plum is neither far enough in hue from purple nor different
enough in lightness; olive and orange differ almost entirely in hue, which is
exactly what protanopia collapses.

## The second, larger question
`MAX_SERIES = SERIES_COLORS.length` means the number of simultaneously plotted
series is defined by how many colors we happened to list. Twelve lines on one plot
with a key as the only identity cue (no direct labels, no texture, no small
multiples) is past what any palette can carry: the `dataviz` guidance is that
beyond roughly eight series the answer is to fold the tail into "Other" or switch
to small multiples, not to generate more hues.

So fixing the two failing pairs makes the palette valid but leaves a chart that is
hard to read for a different reason. Both are worth deciding together.

## Sketch
- Re-pick the six new entries with the validator in the loop rather than by
  reasoning about hue gaps, and keep the original six fixed so existing charts do
  not shift color. Target delta E 15 on the worst pair under normal vision,
  protanopia, deuteranopia and tritanopia.
- Decouple `MAX_SERIES` from palette length. Cap plotted series independently
  (eight is the usual ceiling) and fold the remainder into a single muted "Other"
  series, which the treemap visualization already does for its long tail
  (`maxTiles`, "Other (n)").
- The SLO chart's hover emphasis helps the one series under the cursor and nothing
  else, so it is not a substitute for separable colors.
- Whatever the palette ends up as, the validator run belongs in a test so the next
  extension cannot regress it silently.

## Related
- [slo-budget-chart-unmemoized.md](./slo-budget-chart-unmemoized.md) is the other
  open issue on the same chart.
- The `dataviz` skill carries the validator and the palette guidance.
