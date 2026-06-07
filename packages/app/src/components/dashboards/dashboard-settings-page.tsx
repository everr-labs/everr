import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { dashboardOptions, useSaveDashboard } from "@/data/dashboards/options";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsJsonSection } from "./settings-json-section";
import {
  type SettingsSelection,
  SettingsVariablesSection,
} from "./settings-variables-section";

interface DashboardSettingsPageProps {
  dashboardId: string;
}

export function DashboardSettingsPage({
  dashboardId,
}: DashboardSettingsPageProps) {
  const isNew = dashboardId === "new";
  const storeDashboard = useDashboardStore((s) => s.dashboard);
  const setDashboard = useDashboardStore((s) => s.setDashboard);
  const markSaved = useDashboardStore((s) => s.markSaved);
  const resetStore = useDashboardStore((s) => s.reset);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const saveMutation = useSaveDashboard();
  const navigate = useNavigate();

  // Blocks on store dirty only — un-applied form drafts are guarded by the
  // in-page confirm-discard dialog; leaving the page with a draft is an
  // accepted loss (drafts are not store state).
  const dashboardPrefix = `/dashboards/${dashboardId}`;
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => {
      if (!useDashboardStore.getState().isDirty) return false;
      return !next.pathname.startsWith(dashboardPrefix);
    },
    enableBeforeUnload: () => useDashboardStore.getState().isDirty,
    withResolver: true,
  });

  const { data: fetchedDashboard } = useQuery({
    ...dashboardOptions(dashboardId),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!storeDashboard && fetchedDashboard) {
      setDashboard(fetchedDashboard);
    }
  }, [storeDashboard, fetchedDashboard, setDashboard]);

  const dashboard = storeDashboard ?? fetchedDashboard;

  const [selection, setSelection] = useState<SettingsSelection>({
    kind: "general",
  });
  const [hasUnapplied, setHasUnapplied] = useState(false);
  const [confirmPending, setConfirmPending] =
    useState<SettingsSelection | null>(null);

  const applySelection = useCallback((next: SettingsSelection) => {
    setSelection(next);
    setHasUnapplied(false);
    setConfirmPending(null);
  }, []);

  const requestSelection = useCallback(
    (next: SettingsSelection) => {
      if (JSON.stringify(next) === JSON.stringify(selection)) return;
      if (selection.kind !== "general" && hasUnapplied) {
        setConfirmPending(next);
        return;
      }
      applySelection(next);
    },
    [selection, hasUnapplied, applySelection],
  );

  if (!dashboard) return null;

  // vars is not retained by the layout middlewares, so settings exits forward
  // it explicitly to keep the dashboard's active variable selections.
  const keepVars = (prev: { vars?: Record<string, string | string[]> }) => ({
    ...prev,
    vars: prev.vars,
  });

  const handleSave = () => {
    if (!sourceSlug) return; // Save is hidden for drafts (isNew)
    const newSlug =
      dashboard.metadata.name !== sourceSlug
        ? dashboard.metadata.name
        : undefined;
    saveMutation.mutate(
      { slug: sourceSlug, spec: dashboard.spec, newSlug },
      {
        onSuccess: ({ slug }) => {
          markSaved();
          if (slug !== dashboardId) {
            navigate({
              to: "/dashboards/$dashboardId/settings",
              params: { dashboardId: slug },
              replace: true,
              search: keepVars,
            });
          }
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes on this dashboard. If you leave now, your
              changes will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                resetStore();
                blocker.proceed?.();
              }}
            >
              Discard &amp; leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmPending !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard changes to this variable?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have un-applied edits on this variable. Switching will discard
              them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmPending) applySelection(confirmPending);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link
            to={isNew ? "/dashboards/new" : "/dashboards/$dashboardId"}
            params={isNew ? {} : { dashboardId }}
            search={keepVars}
            className="text-muted-foreground hover:text-foreground"
            viewTransition
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-sm font-semibold">
            Settings — {dashboard.spec.display?.name ?? dashboard.metadata.name}
          </h1>
        </div>
        {!isNew && (
          <div className="flex items-center gap-2">
            {saveMutation.isError && (
              <p className="max-w-md truncate text-xs text-destructive">
                {saveMutation.error instanceof Error
                  ? saveMutation.error.message
                  : "Failed to save"}
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              <Save data-icon="inline-start" />
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r p-2">
          <ul className="flex flex-col gap-1">
            <li>
              <button
                type="button"
                onClick={() => requestSelection({ kind: "general" })}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  selection.kind === "general" && "bg-accent",
                )}
              >
                General
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() =>
                  requestSelection(
                    (dashboard.spec.variables ?? []).length > 0
                      ? { kind: "variable", index: 0 }
                      : { kind: "new-variable" },
                  )
                }
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  (selection.kind === "variable" ||
                    selection.kind === "new-variable") &&
                    "bg-accent",
                )}
              >
                Variables
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => requestSelection({ kind: "json" })}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  selection.kind === "json" && "bg-accent",
                )}
              >
                JSON
              </button>
            </li>
          </ul>
        </nav>
        {selection.kind === "general" ? (
          <SettingsGeneralSection />
        ) : selection.kind === "json" ? (
          <SettingsJsonSection onUnappliedChange={setHasUnapplied} />
        ) : (
          <SettingsVariablesSection
            selection={selection}
            onSelect={requestSelection}
            onForceSelect={applySelection}
            onUnappliedChange={setHasUnapplied}
          />
        )}
      </div>
    </div>
  );
}
