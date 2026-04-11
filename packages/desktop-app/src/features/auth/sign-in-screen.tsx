import { Card, CardContent } from "@everr/ui/components/card";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { AuthStandalone } from "./auth";

export function SignInScreen() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <section className="flex min-h-screen items-center justify-center px-6 py-14">
        <Card className="w-full max-w-[420px] border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
          <CardContent className="grid gap-5 px-6 py-8">
            <p className="m-0 text-center text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--settings-text-soft)]">
              {APP_DISPLAY_NAME}
            </p>
            <AuthStandalone />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
