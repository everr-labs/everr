import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@everr/ui/components/sidebar";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronsUpDown, GitBranch } from "lucide-react";
import { listPreviews } from "@/data/previews/server";

/**
 * App-wide preview context switcher. Lives at the top of the sidebar and drives
 * the `?preview=` search param; every list/detail query downstream reads that
 * param. Speaks the same dropdown-over-a-SidebarMenuButton vocabulary as the
 * org switcher below it, so it inherits the collapsed-rail behaviour for free.
 *
 * When a preview is active the trigger goes amber — the same "not live" hue the
 * diff badges and detail banner use — so the mode is unmistakable, including in
 * the icon-only rail where only the branch glyph shows.
 */
export function PreviewSwitcher() {
  const { preview: rawPreview } = useSearch({
    from: "/_authenticated/_dashboard",
  });
  // Reads already treat "" as live; normalize here too so an empty/whitespace
  // `?preview=` doesn't render a blank trigger label instead of "Live".
  const preview = rawPreview?.trim() || undefined;
  const navigate = useNavigate();
  const { data: previews } = useQuery({
    queryKey: ["previews"],
    queryFn: () => listPreviews(),
  });

  // Nothing to switch to and nothing active: stay out of the way entirely.
  if (!preview && (previews?.length ?? 0) === 0) return null;

  const select = (name: string | undefined) =>
    navigate({
      to: ".",
      search: (prev) => ({ ...prev, preview: name }),
    });

  const active = Boolean(preview);

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  aria-label="Preview context"
                  className={cn(
                    "data-popup-open:bg-sidebar-accent",
                    active &&
                      "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/25 hover:bg-amber-500/15 hover:text-amber-200 data-popup-open:bg-amber-500/15 data-popup-open:text-amber-200",
                  )}
                />
              }
            >
              <GitBranch
                className={active ? "text-amber-400" : "text-muted-foreground"}
              />
              <span className="flex-1 truncate font-medium">
                {preview ?? "Live"}
              </span>
              <ChevronsUpDown className="ml-auto shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom" className="w-56">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Preview context
              </div>
              <DropdownMenuItem onClick={() => select(undefined)}>
                {preview ? (
                  <span className="size-3.5 shrink-0" />
                ) : (
                  <Check className="shrink-0" />
                )}
                <GitBranch className="text-muted-foreground" />
                <span className="flex-1">Live</span>
              </DropdownMenuItem>
              {previews && previews.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {previews.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onClick={() => select(p.name)}
                    >
                      {preview === p.name ? (
                        <Check className="shrink-0" />
                      ) : (
                        <span className="size-3.5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
