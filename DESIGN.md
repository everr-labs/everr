---
name: Everr
description: Software delivery intelligence — a dark, dense instrument panel for developers and their agents.
colors:
  signal-lime: "oklch(0.937 0.264 119.7)"
  signal-lime-ink: "oklch(0.1 0.031 120.757)"
  bg-base: "oklch(0.145 0 0)"
  surface: "oklch(0.205 0 0)"
  surface-muted: "oklch(0.269 0 0)"
  ink: "oklch(0.985 0 0)"
  ink-muted: "oklch(0.708 0 0)"
  slate: "oklch(0.274 0.006 286.033)"
  alert-red: "oklch(0.704 0.191 22.216)"
  border: "oklch(1 0 0 / 10%)"
  field: "oklch(1 0 0 / 15%)"
  chart-1: "oklch(0.905 0.182 98.111)"
  chart-2: "oklch(0.795 0.184 86.047)"
  chart-3: "oklch(0.681 0.162 75.834)"
  chart-4: "oklch(0.554 0.135 66.442)"
  chart-5: "oklch(0.476 0.114 61.907)"
typography:
  display:
    fontFamily: "Space Grotesk Variable, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "source-code-pro, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  full: "9999px"
spacing:
  control-h: "2rem"
  gap-tight: "0.25rem"
  gap: "0.5rem"
  pad-inline: "0.5rem"
  pad-card: "0.75rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.signal-lime-ink}"
    rounded: "{rounded.md}"
    height: "{spacing.control-h}"
    padding: "0 0.5rem"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "{spacing.control-h}"
    padding: "0 0.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    height: "{spacing.control-h}"
    padding: "0 0.5rem"
  button-cta:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.signal-lime-ink}"
    rounded: "{rounded.md}"
    height: "3.5rem"
    padding: "0 1.875rem"
    typography: "{typography.display}"
  badge:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.signal-lime-ink}"
    rounded: "{rounded.full}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "{spacing.control-h}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
---

# Design System: Everr

## 1. Overview

**Creative North Star: "The Instrument Panel"**

Everr's interface is a precision readout for software delivery: dark, dense, and calm at rest, with the lime accent lighting up only what is live, selected, or actionable. It looks like a tool built to be watched under load — legible when the data is thick, fast when the user is mid-incident, and quiet when nothing demands attention. The surface is a continuum of near-black panels stacked by lightness, not by shadow; depth is implied by tonal layering and a single hairline ring, the way a real instrument cluster separates gauges without ornament.

This is a **product** surface where design serves the task. It practices what Everr preaches: an observability tool's own UI must feel instrumented-grade — no sloppy states, no decorative motion, no chrome between the user and the runtime fact. Density is a deliberate feature for experts (tables with many rows, panels with many labels), held legible rather than dumbed down. Standard, trustworthy affordances are used so the tool disappears into the work — then sharpened past the default component-preset look with deliberate type, color restraint, and rhythm.

It explicitly rejects four things: the **legacy enterprise observability** wall-of-dashboards (Datadog/Splunk cramped chrome and a thousand knobs you can look at but never query); the **generic shadcn SaaS template** look (untouched card-grid-of-everything, rounded-everything, gradient accents); **consumer-y over-animation** (bouncy/elastic motion, decorative gradients leaking into the tool); and the **AI-gimmick wrapper** (sparkles badging, a chatbot bolted onto old tooling).

**Key Characteristics:**
- Dark-first, near-black base with tonally-layered panels — depth without shadows.
- A single chartreuse accent (Signal Lime) reserved for live / selected / actionable state.
- Dense, compact controls (32px default height) tuned for expert throughput.
- One consistent interaction signature: dotted focus outline + lime focus ring, expo-out easing.
- Inter for everything functional; Space Grotesk reserved for CTA and marketing display.

## 2. Colors

A monochrome near-black foundation carrying one electric accent and a warm amber-to-ochre ramp for data. Color is meaning, never decoration.

### Primary
- **Signal Lime** (`oklch(0.937 0.264 119.7)`): the one bright wavelength. Reserved for primary actions, the current selection, active navigation, and "live"/firing-pending status. Its rarity against the near-black is the entire point — when it lights up, it means something. Paired with **Signal Lime Ink** (`oklch(0.1 0.031 120.757)`), a near-black green, as its foreground for legible text on the accent.

### Secondary
- **Slate** (`oklch(0.274 0.006 286.033)`): the neutral-action surface for secondary buttons and de-emphasized chips. A faintly cool dark, distinct from the pure-gray surfaces.

### Tertiary (data)
- **Amber → Ochre ramp** (`chart-1` `oklch(0.905 0.182 98.111)` through `chart-5` `oklch(0.476 0.114 61.907)`): the five-step warm series for charts, sparklines, and series differentiation. Warm by deliberate contrast to the cool lime accent, so data series never get confused with interactive state.

### Neutral
- **Base** (`oklch(0.145 0 0)`): the page background — near-black, the bottom of the stack.
- **Surface** (`oklch(0.205 0 0)`): cards, popovers, sidebar, and any panel lifted one level off the base.
- **Surface Muted** (`oklch(0.269 0 0)`): hover/secondary fills, muted accents, separators between dense rows.
- **Ink** (`oklch(0.985 0 0)`): primary text, near-white.
- **Ink Muted** (`oklch(0.708 0 0)`): secondary text, labels, placeholders — kept at a real mid-gray, not faint.
- **Border** (`oklch(1 0 0 / 10%)`) and **Field** (`oklch(1 0 0 / 15%)`): translucent white hairlines and the translucent fill of inputs/outline buttons, so chrome reads as etched into the dark rather than painted on.

### Status
- **Alert Red** (`oklch(0.704 0.191 22.216)`): firing alerts, errors, destructive actions — always at low opacity for fills (`/5`–`/30`), full strength for text/icons. Firing → red, pending → Signal Lime, inactive → muted slate.

### Named Rules
**The Signal Rule.** Signal Lime marks what is live, selected, or actionable — never decoration, never a fill for vibe. If lime appears on an element that isn't interactive or stateful, it's wrong. Its scarcity is what makes it read as signal.

**The No-Shadow Rule.** Depth is tonal, not cast. Panels lift by stepping lightness (Base → Surface → Surface Muted) and a single hairline ring. Drop shadows are prohibited in the app shell.

**The Status-Plus-Shape Rule.** Status never rides on color alone. Pair red/lime/muted with an icon, badge label, or shape so firing/pending/inactive survive colorblind viewing.

## 3. Typography

**Display Font:** Space Grotesk Variable (with sans-serif fallback)
**Body Font:** Inter Variable (with sans-serif fallback)
**Label Font:** Inter Variable (shared family, smaller + medium weight)
**Mono Font:** source-code-pro / Menlo / Monaco / Consolas

**Character:** A geometric-grotesk display paired with a neutral humanist-grotesk workhorse — contrast by role, not by clashing personality. Space Grotesk's wider, slightly mechanical letterforms carry brand/CTA moments; Inter carries every label, control, and dense data cell without drawing attention to itself. Monospace appears wherever data is literal — label sets, IDs, query values, log lines.

### Hierarchy
- **Display** (Space Grotesk, 700, uppercase + wide tracking): CTA buttons and marketing/brand moments only. Not for in-app page titles.
- **Headline / Page Title** (Inter, 700, 1.25rem / `text-xl`): the page `h1` in app routes. Fixed rem, not fluid — controls and sidebars view at consistent DPI.
- **Title** (Inter, 600, ~0.875rem): card titles, section headers, table group labels.
- **Body** (Inter, 400, 0.75rem / `text-xs` at relaxed line-height): the workhorse size for UI text and most prose. Prose blocks cap at 65–75ch; dense tables may run wider.
- **Label** (Inter, 500, 0.625rem / `text-[0.625rem]`): badges, chips, micro-labels.
- **Mono** (source-code-pro, 0.75rem): label key=value pairs, IDs, query strings, log/ANSI output.

### Named Rules
**The Fixed-Scale Rule.** App typography is a fixed rem scale, never `clamp()`. A heading that shrinks inside a sidebar looks worse, not better. Fluid type belongs to the marketing site, not the instrument panel.

**The Space-Grotesk-Is-A-Guest Rule.** The display face appears on CTAs and brand surfaces only. Using it for in-app labels, data, or page titles breaks the "tool disappears into the task" contract.

## 4. Elevation

The system is **flat by tonal layering** — it uses no drop shadows in the app shell. Depth is conveyed by stepping surface lightness off the near-black base (Base `0.145` → Surface `0.205` → Surface Muted `0.269`) and by a single hairline. Cards lift with `ring-1 ring-foreground/10` (a 1px inner ring at 10% white), not a border and not a shadow. The sidebar shares the Surface level, reading as a panel docked to the base rather than floating above it.

Shadows are reserved exclusively for true overlays that leave the document plane — dropdowns, popovers, dialogs, drawers, toasts — where the platform/Base UI primitives bring their own. Inside the content plane, surfaces stay flat.

### Named Rules
**The Ring-Not-Border Rule.** Containers separate from their background with a translucent hairline ring (`ring-1 ring-foreground/10`), not an opaque border and never a colored stripe. The ring etches the panel into the dark; a heavy border paints a box on top of it.

## 5. Components

Built on Base UI primitives with `class-variance-authority` variants. Every interactive component shares one signature: **compact height (2rem / `h-8` default), `rounded-md` corners, a dotted transparent focus outline that resolves into a 2px Signal-Lime focus ring with a 3px offset, and `cubic-bezier(0.19, 1, 0.22, 1)` (expo-out) easing at 200ms.** That signature is the brand at the interaction layer — replicate it, don't reinvent it per component.

Character in one phrase: **precise and dense** — compact, exact, fast; tools that disappear into the task.

### Buttons
- **Shape:** `rounded-md` (0.5rem); icon/xs sizes drop to `rounded-sm` (0.375rem).
- **Sizes:** xs (1.25rem) · sm (1.75rem) · default (2rem) · lg (2.25rem) · xl (3.5rem), plus square icon variants. Default text is `text-xs`.
- **Primary:** Signal Lime fill, Signal Lime Ink text; hover dims to `bg-primary/80`.
- **Outline:** translucent `bg-input/30` over a hairline border; hover `/60`, active `/90`. The default "neutral but present" action.
- **Secondary:** Slate fill, near-white text; hover dims to `/80`.
- **Ghost:** transparent; hover `bg-muted/50`. For toolbar and low-emphasis actions.
- **Destructive:** low-opacity red fill (`bg-destructive/20`), red text — never a solid red block.
- **CTA:** Signal Lime fill in Space Grotesk, uppercase, wide tracking, bold — marketing/hero only, not in-app.
- **Hover / Focus:** all-property transition at 200ms expo-out; focus shows the dotted-outline + lime-ring signature. Disabled drops to 50% opacity, pointer-events off.

### Badges / Chips
- **Style:** pill (`rounded-full`), tiny (1.25rem tall, `text-[0.625rem]`, medium weight), hairline transparent border.
- **Variants:** default (Signal Lime), secondary (Slate), destructive (low-opacity red + red text), outline (hairline + translucent fill), ghost, link.
- **State:** carries status (firing → destructive, pending → default lime, inactive → secondary). Always pair with a label/icon per the Status-Plus-Shape Rule.

### Cards / Containers
- **Corner Style:** `rounded-lg` (0.625rem).
- **Background:** Surface (`oklch(0.205 0 0)`).
- **Elevation Strategy:** flat — `ring-1 ring-foreground/10`, no shadow, no opaque border (see Elevation).
- **Internal Padding:** `py-3 px-3` (0.75rem); a `sm` density drops to `py-2 px-2.5`.
- **Type:** content defaults to `text-xs/relaxed`.

### Inputs / Fields
- **Style:** translucent `bg-input/30` fill, hairline border, `rounded-md`, `h-8`, `px-2`, `text-xs`.
- **Hover:** fill brightens to `/45`.
- **Focus:** border shifts to ring color and the 2px Signal-Lime ring with 3px offset appears (the shared signature).
- **Placeholder:** Ink Muted — a real mid-gray, legible, never faint.
- **Error (`aria-invalid`):** red ring + red border. **Disabled:** 50% opacity, not-allowed cursor.

### Navigation (Sidebar)
- **Style:** Surface-level panel (`bg-sidebar`, same as cards), 16rem wide (3rem collapsed-to-icon, 18rem on mobile sheet), separated from content by a hairline border.
- **States:** active item carries Signal Lime (the selection signal); hover uses `sidebar-accent` (muted) fill. Collapses to an icon rail on narrow viewports — responsive behavior is structural, not fluid type.

### Data Table (signature component)
- The workhorse of the app: dense rows, `text-xs` cells, mono for label/ID/value columns, lime links for cross-references, an explicit empty state (`text-muted-foreground` copy) rather than a blank void. Loading shows skeletons, not a centered spinner. This is where "density is a feature" lives — keep it legible, never cramped-enterprise.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Signal Lime for live / selected / actionable state — the Signal Rule. When it appears, it must mean something.
- **Do** convey depth with tonal layering (Base → Surface → Surface Muted) and a `ring-1 ring-foreground/10` hairline — never a drop shadow in the content plane.
- **Do** keep the one interaction signature on every control: `h-8` default, `rounded-md`, dotted focus outline → 2px lime ring at 3px offset, `cubic-bezier(0.19,1,0.22,1)` at 200ms.
- **Do** pair status color with a label, icon, or shape (firing/pending/inactive must survive colorblind viewing).
- **Do** use Inter for everything functional and a fixed rem type scale; keep `text-muted-foreground` legible, not faint.
- **Do** embrace density where experts need it — wide tables, many labels — while keeping rows readable.
- **Do** use skeleton loaders and teaching empty states, not mid-content spinners or "nothing here."

### Don't:
- **Don't** ship the **generic shadcn SaaS template** look — untouched card-grid-of-everything, rounded-everything, gradient accents. Sharpen the presets.
- **Don't** build the **legacy enterprise observability** wall — cramped chrome, a thousand knobs, dashboards you can look at but never query.
- **Don't** add **consumer-y over-animation** — no bounce, no elastic, no decorative gradients, no choreographed page-load sequences. Motion conveys state only.
- **Don't** ship **AI-gimmick** flourishes — no sparkles badging, no mascot, no chatbot bolted onto the chrome.
- **Don't** use Space Grotesk for in-app labels, data, or page titles — it's a guest, reserved for CTA/brand.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe, gradient text (`background-clip: text`), or glassmorphism as default.
- **Don't** spend Signal Lime on inactive states, decorative fills, or large surfaces — heavy/full-saturation accent on a resting element is always wrong.
- **Don't** use `clamp()` fluid type or drop shadows inside the app shell.
