import { Button } from "@everr/ui/components/button";
import { ContextMenuItem, ContextMenuSeparator } from "@everr/ui/components/context-menu";
import { Copy, ExternalLink, Highlighter, Layers, X, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { FlameNode } from "../model/flame-tree";
import type { FunctionRef } from "../model/sandwich";

type KeyedFunction = FunctionRef & { key: string };

const NO_MATCHES: ReadonlySet<string> = new Set();

/**
 * Links a flame graph and its function table. Hovering a row lights up every
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

/** The right-click menu of a flame graph frame. */
export function FrameMenuItems({
  node,
  pinned,
  sourceUrl,
  onZoom,
  onResetZoom,
  onTogglePin,
  onShowCallers,
}: {
  node: FlameNode;
  pinned: boolean;
  sourceUrl: string | undefined;
  onZoom: () => void;
  onResetZoom: () => void;
  onTogglePin: () => void;
  /** Absent where there is no room for the callers and callees view. */
  onShowCallers?: () => void;
}) {
  // The root frame is the whole profile, not a function.
  if (!node.parent) {
    return (
      <ContextMenuItem onClick={onResetZoom}>
        <ZoomOut />
        Reset zoom
      </ContextMenuItem>
    );
  }
  return (
    <>
      <ContextMenuItem onClick={onZoom}>
        <ZoomIn />
        Zoom to frame
      </ContextMenuItem>
      {onShowCallers ? (
        <ContextMenuItem onClick={onShowCallers}>
          <Layers />
          Callers and callees
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onClick={onTogglePin}>
        <Highlighter />
        {pinned ? "Stop highlighting" : "Highlight function"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {sourceUrl ? (
        <ContextMenuItem
          render={
            // The item merges its icon and label into the link.
            <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label="Open source" />
          }
        >
          <ExternalLink />
          Open source
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        onClick={() => {
          navigator.clipboard.writeText(node.name).then(
            () => toast.success("Function name copied"),
            () => toast.error("Could not copy the function name"),
          );
        }}
      >
        <Copy />
        Copy function name
      </ContextMenuItem>
    </>
  );
}
