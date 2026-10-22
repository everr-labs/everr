export function WorkspaceAccessRequired() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm space-y-4">
        <h1 className="font-heading text-3xl">Workspace access required</h1>
        <p className="text-muted-foreground">
          You do not have access to this workspace. Contact your administrator for an invitation, or
          open the invitation you received.
        </p>
      </div>
    </main>
  );
}
