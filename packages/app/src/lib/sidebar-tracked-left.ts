// Left-edge classes for viewport-fixed chrome (topnav, preview pill lane).
// Fixed elements escape the macOS rubber-band (which only translates in-flow
// content), but they position against the viewport, not the sidebar inset —
// so their left edge must track the sidebar rail.
//
// Pure CSS on purpose: the sidebar stamps `data-collapsible="icon"` on its DOM
// node while collapsed, and the provider wrapper carries `group/sidebar-wrapper`,
// so a `group-has-*` variant keys the left edge off the same attribute mutation
// that drives the sidebar's own 200ms ease-linear width transition — same-frame
// start, and no `useSidebar()` subscription re-rendering the header/pill subtree
// mid-animation (that re-render is what made the collapse janky).
// Below `md` the sidebar is an offcanvas sheet, so chrome spans from the
// viewport edge.
export const SIDEBAR_TRACKED_LEFT =
  "left-0 transition-[left] duration-200 ease-linear md:left-(--sidebar-width) md:group-has-data-[collapsible=icon]/sidebar-wrapper:left-(--sidebar-width-icon)";
