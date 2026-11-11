import type { ReactNode } from "react";

/**
 * One section of the Error detail page: a heading with its controls on the
 * right, then the content. The sections stack in one column and the page sets
 * the space between them.
 */
export function ErrorDetailSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  /** Short text that follows the heading, for example a count or an ID. */
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? (
          <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs">
            {description}
          </div>
        ) : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
