import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeft, BookOpenText } from "lucide-react";

export function AlertingBackLink({
  to,
  label,
}: {
  to: LinkProps["to"];
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/50 hover:text-foreground"
      aria-label={label}
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}

export function AlertingRunbookLink({
  project,
  slug,
  name,
}: {
  project: string;
  slug: string;
  name: string;
}) {
  return (
    <Link
      to="/runbooks/$project/$slug"
      params={{ project, slug }}
      aria-label={`Open runbook for ${name}`}
      title="Open runbook"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:bg-muted/50 hover:text-foreground focus-visible:outline-primary"
    >
      <BookOpenText className="size-3.5" />
    </Link>
  );
}
