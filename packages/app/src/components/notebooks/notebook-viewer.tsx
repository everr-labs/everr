import { useSuspenseQuery } from "@tanstack/react-query";
import { FileQuestion } from "lucide-react";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { VariableBar } from "@/components/dashboards/variable-bar";
import { notebookOptions } from "@/data/notebooks/options";
import {
  findPage,
  pageNavTree,
  toDashboardDocument,
} from "@/data/notebooks/pages";
import { NotebookMarkdown } from "./notebook-markdown";
import { NotebookPageNav } from "./notebook-page-nav";

export function NotebookViewer({
  project,
  slug,
  pagePath,
}: {
  project: string;
  slug: string;
  /** "" = index page; "a/b" = nested page path from the splat. */
  pagePath: string;
}) {
  // The notebook is immutable (gitops, read-only), so the query cache is the
  // single source of truth; the route loader has already ensured the data.
  const { data: notebook } = useSuspenseQuery(notebookOptions(project, slug));
  const page = findPage(notebook.spec, pagePath);
  const tree = pageNavTree(notebook.spec);
  const indexTitle = notebook.spec.display?.name ?? slug;

  return (
    <DashboardProvider document={toDashboardDocument(notebook, project, slug)}>
      <div className="flex gap-6">
        {tree.length > 0 && (
          <NotebookPageNav
            project={project}
            slug={slug}
            indexTitle={indexTitle}
            tree={tree}
            activePath={page ? pagePath : ""}
          />
        )}
        <div className="min-w-0 max-w-4xl flex-1">
          <VariableBar />
          {page ? (
            <NotebookMarkdown markdown={page.markdown} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <FileQuestion className="size-10" />
              <p className="text-sm">
                This notebook has no page &ldquo;{pagePath}&rdquo;
              </p>
            </div>
          )}
        </div>
      </div>
    </DashboardProvider>
  );
}
