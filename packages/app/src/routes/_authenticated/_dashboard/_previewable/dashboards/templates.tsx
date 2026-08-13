import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import * as z from "zod";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { TemplateGallery } from "@/components/dashboards/template-gallery";
import { DASHBOARD_TEMPLATES } from "@/data/dashboards/templates/catalog";

/** Opened when the URL names no template. */
const DEFAULT_TEMPLATE = DASHBOARD_TEMPLATES[0]?.id ?? "";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/templates",
)({
  staticData: {
    breadcrumb: () => [
      { label: "Dashboards", to: "/dashboards" },
      { label: "Templates" },
    ],
  },
  head: () => ({
    meta: [{ title: "Everr - Dashboard templates" }],
    // The preview renders through the same grid the dashboard route uses, so it
    // needs the same stylesheets.
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
  // Which template the right pane shows. In the URL so a chosen template is
  // shareable and survives a reload, and defaulted rather than optional: with no
  // value the preview would follow whatever the search filter left first, so
  // typing would mount a different dashboard on every settled keystroke.
  validateSearch: z.object({
    template: z
      .string()
      .max(100)
      .default(DEFAULT_TEMPLATE)
      .catch(DEFAULT_TEMPLATE),
  }),
  component: DashboardTemplatesPage,
});

function DashboardTemplatesPage() {
  const { template } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <TemplateGallery
      selectedId={template}
      onSelect={(id) =>
        // `replace` so walking the list doesn't bury the page the reader came
        // from under one history entry per template. `vars` is dropped because
        // each template declares its own: carrying a previous template's
        // variable values forward leaves them stranded in the URL, and a name
        // collision would silently apply one template's selection to another.
        void navigate({
          search: (prev) => ({ ...prev, template: id, vars: undefined }),
          replace: true,
        })
      }
    />
  );
}
