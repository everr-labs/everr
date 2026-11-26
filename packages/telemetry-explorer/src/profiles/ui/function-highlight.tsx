import { Button, buttonVariants } from "@everr/ui/components/button";
import { ContextMenuItem, ContextMenuSeparator } from "@everr/ui/components/context-menu";
import { Copy, ExternalLink, Highlighter, Layers, X, ZoomIn, ZoomOut } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import type { FlameNode } from "../model/flame-tree";
import type { FunctionRef } from "../model/sandwich";

type KeyedFunction = FunctionRef & { key: string };

const NO_MATCHES: ReadonlySet<string> = new Set();

/**
 * Links a flamegraph and its function table. Hovering a row lights up every
 * frame of that function, clicking one keeps it lit, and hovering a frame
 * marks its row.
 */
export function useFunctionHighlight(nodes: ReadonlyMap<string, FlameNode>) {
  const [pinned, setPinned] = useState<KeyedFunction>();
  const [hoveredRow, setHoveredRow] = useState<string>();
  const [hoveredFrame, setHoveredFrame] = useState<string>();
  const idsByKey = useMemo(() => {
    const index = new Map<string, Set<string>>();
    for (const [id, node] of nodes) {
      let ids = index.get(node.key);
      if (!ids) {
        ids = new Set();
        index.set(node.key, ids);
      }
      ids.add(id);
    }
    return index;
  }, [nodes]);
  const highlightKey = hoveredRow ?? pinned?.key;

  return {
    pinned,
    togglePin: (fn: KeyedFunction) =>
      setPinned((current) => (current?.key === fn.key ? undefined : fn)),
    clearPin: () => setPinned(undefined),
    flamegraph: {
      matchingIds: (highlightKey && idsByKey.get(highlightKey)) || NO_MATCHES,
      filterActive: highlightKey !== undefined,
      onHoverChange: (id: string | undefined) =>
        setHoveredFrame(id === undefined ? undefined : nodes.get(id)?.key),
    },
    table: {
      activeKey: pinned?.key,
      hoveredKey: hoveredFrame,
      onHover: setHoveredRow,
    },
  };
}

/** The pinned function, with a button to stop highlighting it. */
export function PinnedFunction({ fn, onClear }: { fn: FunctionRef; onClear: () => void }) {
  return (
    <span className="bg-muted inline-flex min-w-0 items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2">
      <Highlighter className="text-muted-foreground size-3 shrink-0" />
      <span className="truncate font-mono" title={fn.file ? `${fn.name}\n${fn.file}` : fn.name}>
        {fn.name}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Stop highlighting ${fn.name}`}
        onClick={onClear}
      >
        <X />
      </Button>
    </span>
  );
}

type FrameActionProps = {
  node: FlameNode;
  pinned: boolean;
  sourceUrl: string | undefined;
  /** Absent where the frame is already zoomed into, as after a tap. */
  onZoom?: () => void;
  onResetZoom: () => void;
  onTogglePin: () => void;
  /** Absent where there is no room for the callers and callees view. */
  onShowCallers?: () => void;
};

type FrameAction = {
  label: string;
  icon: ReactNode;
  /** Starts a group: opening the code and copying, after the view actions. */
  grouped?: boolean;
} & ({ onSelect: () => void; href?: never } | { href: string; onSelect?: never });

function copyFunctionName(name: string) {
  navigator.clipboard.writeText(name).then(
    () => toast.success("Function name copied"),
    () => toast.error("Could not copy the function name"),
  );
}

/** What can be done with a frame, shared by its right-click menu and its touch drawer. */
function frameActions({
  node,
  pinned,
  sourceUrl,
  onZoom,
  onResetZoom,
  onTogglePin,
  onShowCallers,
}: FrameActionProps): FrameAction[] {
  // The root frame is the whole profile, not a function.
  if (!node.parent) return [{ label: "Reset zoom", icon: <ZoomOut />, onSelect: onResetZoom }];
  const actions: FrameAction[] = [];
  if (onZoom) actions.push({ label: "Zoom to frame", icon: <ZoomIn />, onSelect: onZoom });
  if (onShowCallers) {
    actions.push({ label: "Callers and callees", icon: <Layers />, onSelect: onShowCallers });
  }
  actions.push({
    label: pinned ? "Stop highlighting" : "Highlight function",
    icon: <Highlighter />,
    onSelect: onTogglePin,
  });
  if (sourceUrl) {
    actions.push({ label: "Open source", icon: <ExternalLink />, href: sourceUrl, grouped: true });
  }
  actions.push({
    label: "Copy function name",
    icon: <Copy />,
    onSelect: () => copyFunctionName(node.name),
    grouped: !sourceUrl,
  });
  return actions;
}

/** The right-click menu of a flamegraph frame. */
export function FrameMenuItems(props: FrameActionProps) {
  return frameActions(props).map((action) => (
    <Fragment key={action.label}>
      {action.grouped ? <ContextMenuSeparator /> : null}
      {action.href ? (
        <ContextMenuItem
          render={
            // The item merges its icon and label into the link.
            <a href={action.href} target="_blank" rel="noreferrer" aria-label={action.label} />
          }
        >
          {action.icon}
          {action.label}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={action.onSelect}>
          {action.icon}
          {action.label}
        </ContextMenuItem>
      )}
    </Fragment>
  ));
}

/** The same actions as finger-sized rows, for a frame's touch drawer. */
export function FrameActionList({ onDone, ...props }: FrameActionProps & { onDone: () => void }) {
  const row = buttonVariants({
    variant: "ghost",
    className: "h-11 w-full justify-start gap-3 px-4 text-sm [&_svg]:size-4",
  });
  return (
    <div className="flex flex-col py-1">
      {frameActions(props).map((action) => (
        <Fragment key={action.label}>
          {action.grouped ? <div className="bg-border my-1 h-px" /> : null}
          {action.href ? (
            <a href={action.href} target="_blank" rel="noreferrer" className={row} onClick={onDone}>
              {action.icon}
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              className={row}
              onClick={() => {
                action.onSelect?.();
                onDone();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}
