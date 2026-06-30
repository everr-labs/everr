import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { markdownExcerpt } from "@/data/runbooks/excerpt";
import { runbookOptions } from "@/data/runbooks/options";
import { usePreviewViewport } from "./use-preview-viewport";

export function RunbookCardPreview({
  project,
  slug,
}: {
  project: string;
  slug: string;
}) {
  const { ref, inView } = usePreviewViewport<HTMLDivElement>();
  const { data: doc } = useQuery({
    ...runbookOptions(project, slug),
    enabled: inView,
  });
  const inline = doc?.spec.markdown.inline ?? "";

  return (
    <div ref={ref} className="size-full overflow-hidden p-3">
      {doc ? (
        <p className="line-clamp-6 text-xs leading-relaxed text-muted-foreground">
          {markdownExcerpt(inline)}
        </p>
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </div>
  );
}
