import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";

interface WorkflowLinkProps {
  repo: string;
  workflowName: string;
  /**
   * When false, renders the workflow name as plain text instead of a link to
   * its detail page (e.g. inside the workflow detail page's Recent Runs, where
   * the link would point back at the current page).
   */
  link?: boolean;
  className?: string;
}

export function WorkflowLink({ repo, workflowName, link = true, className }: WorkflowLinkProps) {
  if (!link) {
    return (
      <div className={cn("truncate", className)} title={workflowName}>
        {workflowName}
      </div>
    );
  }

  return (
    <Link
      to="/workflows/$repo/$workflowName"
      params={{ repo, workflowName }}
      className={cn("font-medium hover:underline", className)}
      title={`Open ${workflowName} workflow detail`}
    >
      {workflowName}
    </Link>
  );
}
