import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";

interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  dashboardCount: number;
  folderCount: number;
  isPending?: boolean;
  onConfirm: (mode: "cascade" | "move-to-root") => void;
}

function contentsLabel(dashboardCount: number, folderCount: number): string {
  const parts: string[] = [];
  if (dashboardCount > 0) {
    parts.push(`${dashboardCount} dashboard${dashboardCount === 1 ? "" : "s"}`);
  }
  if (folderCount > 0) {
    parts.push(`${folderCount} subfolder${folderCount === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  name,
  dashboardCount,
  folderCount,
  isPending,
  onConfirm,
}: DeleteFolderDialogProps) {
  const isEmpty = dashboardCount === 0 && folderCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? `This will delete the empty folder "${name}".`
              : `"${name}" contains ${contentsLabel(dashboardCount, folderCount)}. Choose what happens to its contents.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isEmpty ? (
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => onConfirm("cascade")}
            >
              Delete
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => onConfirm("move-to-root")}
              >
                Move contents to root
              </Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => onConfirm("cascade")}
              >
                Delete everything
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
