import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_welcome/_guest")({
  beforeLoad: ({ context: { session } }) => {
    if (session?.user) {
      throw redirect({ to: "/" });
    }
  },
  component: GuestLayout,
});

function GuestLayout() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <Outlet />
      </div>
    </main>
  );
}
