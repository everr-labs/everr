// Left-edge classes for viewport-fixed chrome (topnav, preview bar). Fixed
// elements escape the macOS rubber-band but position against the viewport, so
// their left edge must track the sidebar rail. Pure CSS (`group-has` on the
// sidebar's `data-collapsible` attr) so it rides the sidebar's own width
// transition without a `useSidebar()` re-render mid-collapse. Below `md` the
// sidebar is offcanvas, so chrome spans from the viewport edge.
export const SIDEBAR_TRACKED_LEFT =
  "left-0 transition-[left] duration-200 ease-sidebar motion-reduce:transition-none md:left-(--sidebar-width) md:group-has-data-[collapsible=icon]/sidebar-wrapper:left-(--sidebar-width-icon)";
