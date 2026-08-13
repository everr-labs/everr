import { createFileRoute, useNavigate } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import * as z from "zod";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { TemplateGallery } from "@/components/dashboards/template-gallery";

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
  // shareable and survives a reload; an unknown id falls back to the first
  // template the filters leave visible rather than erroring.
  validateSearch: z.object({
    template: z.string().max(100).optional().catch(undefined),
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
        // from under one history entry per template.
        void navigate({
          search: (prev) => ({ ...prev, template: id }),
          replace: true,
        })
      }
    />
  );
}
