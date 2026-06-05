import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { cn } from "@everr/ui/lib/utils";
import { Folder, House } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { type FolderSummary, flattenFolders } from "@/data/dashboards/tree";

interface FolderListProps {
  folders: FolderSummary[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  disabledIds?: Set<string>;
}

export function FolderList({
  folders,
  value,
  onChange,
  disabledIds,
}: FolderListProps) {
  return (
    <div className="border-border max-h-64 overflow-y-auto rounded-md border p-1">
      <FolderRow
        name="Root"
        icon={<House className="size-3.5 text-muted-foreground" />}
        depth={0}
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {flattenFolders(folders).map(({ folder, depth }) => (
        <FolderRow
          key={folder.id}
          name={folder.name}
          icon={<Folder className="size-3.5 text-muted-foreground" />}
          depth={depth + 1}
          selected={value === folder.id}
          disabled={disabledIds?.has(folder.id)}
          onClick={() => onChange(folder.id)}
        />
      ))}
    </div>
  );
}

function FolderRow({
  name,
  icon,
  depth,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  icon: ReactNode;
  depth: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        disabled && "pointer-events-none opacity-50",
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {icon}
      <span className="truncate">{name}</span>
    </button>
  );
}

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  folders: FolderSummary[];
  initialFolderId?: string | null;
  disabledIds?: Set<string>;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: (folderId: string | null) => void;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  title,
  folders,
  initialFolderId = null,
  disabledIds,
  confirmLabel = "Move",
  isPending,
  onConfirm,
}: FolderPickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(initialFolderId);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(initialFolderId);
    }
    wasOpen.current = open;
  }, [open, initialFolderId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <FolderList
          folders={folders}
          value={selected}
          onChange={setSelected}
          disabledIds={disabledIds}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={isPending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
