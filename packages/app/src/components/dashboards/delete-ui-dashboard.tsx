import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteUiDashboard } from "@/data/dashboards/server";

/**
 * Deleting is offered only for Dashboards the app created and still owns.
 *
 * An as-code Dashboard is defined by files in a repository: deleting the row
 * would put the app and the repository out of step until the next apply put it
 * straight back. So the affordance is absent rather than disabled-with-a-reason
 * — there is no action to take here, and the real one lives in the files. The
 * same rule is enforced in the delete statement itself, not just by hiding this
 * button.
 */
export function DeleteUiDashboard({
  project,
  slug,
  name,
}: {
  project: string;
  slug: string;
  name: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => deleteUiDashboard({ data: { project, slug } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      toast.success(`Deleted ${name}`);
      void navigate({ to: "/dashboards" });
    },
    onError: (error) =>
      toast.error("Couldn't delete the dashboard", {
        description: error instanceof Error ? error.message : undefined,
      }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${name}`}
            className="text-muted-foreground hover:text-destructive"
          />
        }
      >
        <Trash2 className="size-3.5" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes{" "}
            <span className="font-mono text-foreground/90">
              {project} / {slug}
            </span>{" "}
            for everyone in this organization. Any changes made to it are lost;
            the template it came from can always create a fresh copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? "Deleting…" : "Delete dashboard"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
