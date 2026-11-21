import "@tanstack/react-router";

// The shell's own keys (`breadcrumb`, `showDataControls`, `hideTimeRangePicker`)
// are declared by @everr/app-shell.
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    authEntry?: "/auth/sign-up";
    // Suppresses the `PreviewFrame` banner in `_previewable.tsx`. Set on pages
    // that show live/operational state rather than an as-code resource a
    // preview branch could change, so the banner doesn't imply a preview
    // overlay that isn't actually there.
    hidePreviewFrame?: boolean;
    /**
     * The route owns its scroll and touches the content edges (explorer-style
     * split panes): the `_previewable` layout skips PageContainer and its
     * page scroll for matches carrying this.
     */
    fullBleed?: boolean;
    /**
     * The page shows a `FrameToggle` for the rail frame it sits in, so on a
     * phone the rail can leave the layout and open as a sheet from it.
     */
    railToggle?: boolean;
  }
}
