---
name: 011-click-heatmap
title: Decide click heatmap capture and visualization
labels: [wayfinder:grilling]
status: closed
assignee: guido
blocked-by: [008-analytics-log-schema]
---

## Question

What extra data must click events carry to power a per-page click heatmap (coordinates, viewport size, element selector or fingerprint, scroll depth), and how is the heatmap rendered: an Everr dashboard visualization, an overlay on the live page, or a query recipe? Consult the dataviz skill for the rendering decision. Depends on the click event shape fixed by the analytics schema.

## Resolution

The clickmap is not planned for now: this spec ships no heatmap visualization, and building one is a separate future effort.

What was settled on the way to that call:

- Capture stays the ticket 008 click payload as-is: selector, ancestor chain, page-pixel coordinates, viewport size. No mousemove sampling and no element-relative offsets. Click data therefore accrues from day one, so a future clickmap effort starts with a full dataset and needs no SDK changes.
- Direction if it is ever built: an element-based clickmap aggregated over everr.element.selector, rendered as dashboard panels with existing viz types (Table, BarChart). A pixel-density or live-page overlay view was surveyed and found expensive: the app has no page-screenshot or iframe-preview infrastructure, and an on-page overlay would need a new aggregates API plus an auth story.
